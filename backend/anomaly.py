"""
Z-score based anomaly detection shared across all providers.

Mirrors the logic used in the internal cloud-cost-tracker tool:
- Baseline = trailing N days (excluding the current day)
- z = (today - mean) / stdev
- Flag if z >= threshold AND abs(today - mean) >= min_dollar_delta
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Sequence


@dataclass
class AnomalyResult:
    is_anomaly: bool
    z_score: float
    baseline_mean: float
    baseline_stdev: float
    today_value: float
    pct_vs_baseline: float
    delta: float
    severity: str = "ok"  # ok | warn | danger


@dataclass
class AnomalySettings:
    z_threshold: float = 2.0
    min_dollar_delta: float = 5.0
    baseline_window_days: int = 14


def detect_anomaly(
    series: Sequence[float],
    settings: AnomalySettings = AnomalySettings(),
) -> AnomalyResult:
    """
    series: chronological list of daily values, where series[-1] is "today"
    and everything before it (up to baseline_window_days) is the baseline.
    """
    if len(series) < 2:
        today = series[-1] if series else 0.0
        return AnomalyResult(
            is_anomaly=False,
            z_score=0.0,
            baseline_mean=today,
            baseline_stdev=0.0,
            today_value=today,
            pct_vs_baseline=0.0,
            delta=0.0,
        )

    today_value = series[-1]
    baseline = series[:-1][-settings.baseline_window_days :]

    mean = statistics.fmean(baseline) if baseline else 0.0
    stdev = statistics.pstdev(baseline) if len(baseline) > 1 else 0.0

    z = (today_value - mean) / stdev if stdev > 0 else 0.0
    delta = today_value - mean
    pct = (delta / mean * 100) if mean > 0 else 0.0

    is_anomaly = abs(z) >= settings.z_threshold and abs(delta) >= settings.min_dollar_delta

    if is_anomaly and z >= settings.z_threshold * 1.5:
        severity = "danger"
    elif is_anomaly:
        severity = "warn"
    else:
        severity = "ok"

    return AnomalyResult(
        is_anomaly=is_anomaly,
        z_score=round(z, 2),
        baseline_mean=round(mean, 2),
        baseline_stdev=round(stdev, 2),
        today_value=round(today_value, 2),
        pct_vs_baseline=round(pct, 1),
        delta=round(delta, 2),
        severity=severity,
    )


def detect_anomaly_sma(
    series: Sequence[float],
    short_window: int = 7,
    long_window: int = 20,
    spike_threshold_pct: float = 15.0,
) -> AnomalyResult:
    """
    SMA(7)/SMA(20) crossover-and-magnitude based anomaly detection.
    Flags today as anomalous if today's value deviates from the SMA(20)
    baseline by more than spike_threshold_pct, mirroring the "spike"/"dip"
    signal logic already used for the daily chart annotations.
    """
    if len(series) < long_window:
        today = series[-1] if series else 0.0
        return AnomalyResult(
            is_anomaly=False,
            z_score=0.0,
            baseline_mean=today,
            baseline_stdev=0.0,
            today_value=today,
            pct_vs_baseline=0.0,
            delta=0.0,
        )

    today_value = series[-1]
    sma_short = _sma(series, short_window)[-1]
    sma_long = _sma(series, long_window)[-1]

    pct_vs_long = ((today_value - sma_long) / sma_long * 100) if sma_long else 0.0
    delta = today_value - sma_long if sma_long else 0.0

    is_anomaly = abs(pct_vs_long) >= spike_threshold_pct

    if is_anomaly and abs(pct_vs_long) >= spike_threshold_pct * 1.5:
        severity = "danger"
    elif is_anomaly:
        severity = "warn"
    else:
        severity = "ok"

    return AnomalyResult(
        is_anomaly=is_anomaly,
        z_score=round((sma_short - sma_long) / sma_long, 2) if sma_long else 0.0,
        baseline_mean=round(sma_long, 2) if sma_long else 0.0,
        baseline_stdev=0.0,
        today_value=round(today_value, 2),
        pct_vs_baseline=round(pct_vs_long, 1),
        delta=round(delta, 2),
        severity=severity,
    )


def _sma(values: Sequence[float], window: int) -> list[float | None]:
    """
    Simple moving average over `values`, where each point is the mean of the
    trailing `window` values (inclusive of itself). Returns None for indices
    before there's a full window of history.
    """
    out: list[float | None] = []
    for i in range(len(values)):
        if i + 1 < window:
            out.append(None)
        else:
            out.append(round(statistics.fmean(values[i + 1 - window : i + 1]), 2))
    return out


def compute_sma_series(
    daily_series: Sequence[dict],
    short_window: int = 7,
    long_window: int = 20,
) -> list[dict]:
    """
    Takes a chronological list of {"date": str, "value": float} dicts and
    annotates each point with:
      - sma_short / sma_long: the trailing SMA values (None until enough history)
      - pct_vs_sma_long: today's value vs the 20-day SMA, as a signed percent
      - signal: "spike" | "dip" | "crossover_up" | "crossover_down" | "normal"

    "spike"/"dip" mirror how % moves are typically read off a 7d/20d SMA pair:
    when the short SMA pulls meaningfully away from the long SMA, that's flagged
    as a spike (above) or dip (below). A crossover marks the day the short SMA
    actually crosses the long SMA line, similar to a golden/death cross.
    """
    values = [d["value"] for d in daily_series]
    sma_short = _sma(values, short_window)
    sma_long = _sma(values, long_window)

    annotated = []
    prev_diff: float | None = None

    for i, d in enumerate(daily_series):
        s_short = sma_short[i]
        s_long = sma_long[i]

        pct_vs_long = None
        signal = "normal"

        if s_long:
            pct_vs_long = round((d["value"] - s_long) / s_long * 100, 1)

        if s_short is not None and s_long is not None and s_long > 0:
            diff = s_short - s_long
            crossed = prev_diff is not None and (
                (prev_diff <= 0 and diff > 0) or (prev_diff >= 0 and diff < 0)
            )

            # Check the single-day magnitude FIRST — a big spike/dip on the day
            # itself should never be masked just because the 7d/20d SMA lines
            # happened to cross on the same day.
            if pct_vs_long is not None and abs(pct_vs_long) >= 15:
                signal = "spike" if pct_vs_long > 0 else "dip"
            elif crossed:
                signal = "crossover_up" if diff > 0 else "crossover_down"

            prev_diff = diff

        annotated.append(
            {
                **d,
                "sma_short": s_short,
                "sma_long": s_long,
                "pct_vs_sma_long": pct_vs_long,
                "signal": signal,
            }
        )

    return annotated


def compute_drivers(
    dim_daily: dict[str, dict[str, float]],
    sorted_days: list[str],
    settings: AnomalySettings,
    max_drivers: int = 3,
) -> list[dict]:
    """
    For each sub-dimension, build a dense daily series aligned to sorted_days,
    run detect_anomaly(), collect those that fired, sort by |delta| descending,
    and return the top max_drivers as anomaly_drivers records.

    Returns [] when no individual dimension crosses the threshold
    (cost crept up broadly rather than one item spiking).

    dim_daily: {dimension_name: {date_str: amount}}
    sorted_days: chronological date list where sorted_days[-1] is today
    """
    if not sorted_days or not dim_daily:
        return []

    drivers = []
    for name, day_map in dim_daily.items():
        series = [day_map.get(d, 0.0) for d in sorted_days]
        result = detect_anomaly(series, settings)
        if result.is_anomaly:
            drivers.append({
                "name": name,
                "today": result.today_value,
                "baseline_mean": result.baseline_mean,
                "delta": result.delta,
                "pct_vs_baseline": result.pct_vs_baseline,
            })

    drivers.sort(key=lambda d: abs(d["delta"]), reverse=True)
    return drivers[:max_drivers]


def explain_anomaly(provider_label: str, anomaly, drivers: list[dict], currency_symbol: str = "$") -> str:
    """
    Plain-English explanation of an anomaly for a non-technical reader.
    Uses ONLY values already present on the anomaly object and drivers list
    — never invents numbers.
    provider_label: e.g. "AWS", "RunPod", "Google Ads"
    anomaly: an AnomalyResult (has .is_anomaly, .today_value, .baseline_mean,
             .pct_vs_baseline, .delta, .z_score)
    drivers: list of dicts with keys name/today/baseline_mean/delta/pct_vs_baseline
             (may be empty list)
    currency_symbol: "$" for USD providers, "₹" for INR providers — caller
             must pass the CORRECT symbol for that provider, matching
             whatever this provider's fmt() already uses elsewhere in the
             app. Do not hardcode this to "₹" — AWS/RunPod/Google Ads are
             USD.
    """
    if not anomaly.is_anomaly:
        return ""

    direction_word = "increased" if anomaly.delta > 0 else "decreased"
    comparison_word = "higher" if anomaly.delta > 0 else "lower"
    pct = abs(anomaly.pct_vs_baseline)

    sentence_1 = (
        f"{provider_label} spend {direction_word} sharply today — "
        f"{currency_symbol}{anomaly.today_value:,.0f} compared to a normal "
        f"day of about {currency_symbol}{anomaly.baseline_mean:,.0f}, "
        f"roughly {pct:.0f}% {comparison_word} than usual."
    )

    if drivers:
        top = drivers[0]
        driver_direction = "jumped to" if top["delta"] > 0 else "dropped to"
        sentence_2 = (
            f"Most of this change is coming from {top['name']}, which "
            f"{driver_direction} {currency_symbol}{top['today']:,.0f} "
            f"(normally around {currency_symbol}{top['baseline_mean']:,.0f})."
        )
        if len(drivers) > 1:
            other_names = ", ".join(d["name"] for d in drivers[1:3])
            sentence_3 = f" Other contributing factors: {other_names}."
        else:
            sentence_3 = ""
    else:
        sentence_2 = (
            "The change wasn't concentrated in one specific area — it "
            "looks like a broad shift across several items rather than "
            "one clear cause."
        )
        sentence_3 = ""

    return f"{sentence_1} {sentence_2}{sentence_3}"