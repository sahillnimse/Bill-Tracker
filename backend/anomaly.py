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
