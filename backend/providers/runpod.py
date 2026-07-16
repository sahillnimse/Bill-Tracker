"""
RunPod provider — pulls billing + live pod status via RunPod's REST API.

RunPod's GraphQL `myself.pods` and REST `/v1/pods` only list pods that are
CURRENTLY running — once a pod is stopped/terminated, it vanishes from both,
even though it was billed real money while it ran. So this provider uses:
  - REST `/v1/billing/pods` for GPU pod spend (works whether or not anything
    is running right now, and survives pod termination)
  - REST `/v1/billing/endpoints` for serverless spend — a SEPARATE billing
    stream from pods. An account can have zero pod spend and still have
    significant serverless spend (or vice versa), so both must be fetched
    and summed together for an accurate total.
  - REST `/v1/pods` only for "how many pods are running right now" (a live
    status count, separate from historical billing)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from anomaly import AnomalySettings, compute_drivers, detect_anomaly, detect_anomaly_sma
from config import app_config, runpod_config

logger = logging.getLogger("spendwatch.runpod")

REST_BASE = "https://rest.runpod.io/v1"

RUNPOD_BILLING_VERIFY_ERROR = "Unable to verify billing data — check RunPod API key configuration."
RUNPOD_BILLING_PENDING = (
    "A pod is currently running, but today's usage hasn't been reflected in billing data yet. "
    "RunPod bills in near real-time, so this should update shortly."
)
RUNPOD_STOPPED_STORAGE_NOTE = (
    "No compute charges — pod is stopped. Note: attached storage may still be billing even while a pod isn't running."
)


def _rest_get(path: str, params: dict | None = None) -> Any:
    if not runpod_config.api_key:
        raise RuntimeError(RUNPOD_BILLING_VERIFY_ERROR)

    try:
        resp = httpx.get(
            f"{REST_BASE}{path}",
            headers={"Authorization": f"Bearer {runpod_config.api_key}"},
            params=params or {},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise RuntimeError(RUNPOD_BILLING_VERIFY_ERROR) from exc
        raise


def _fetch_active_pods() -> list[dict[str, Any]]:
    """Live pod list — only reflects pods running right now."""
    result = _rest_get("/pods")
    if isinstance(result, list):
        return result
    # RunPod may return a wrapped object (e.g. {"pods": [...]}) or an error dict.
    # Log it so we can tell this apart from a genuinely empty account.
    if isinstance(result, dict):
        # Handle common wrapped shapes first
        if "pods" in result:
            pods = result["pods"]
            if isinstance(pods, list):
                logger.info("RunPod /pods returned wrapped shape {pods: [...]}, unwrapping")
                return pods
        logger.warning(
            "RunPod /pods returned unexpected dict (not a bare list): %s — "
            "treating as empty pod list. Check API key or RunPod API changes.",
            list(result.keys()),
        )
    else:
        logger.warning(
            "RunPod /pods returned unexpected type %s: %r — treating as empty.",
            type(result).__name__,
            result,
        )
    return []


def _fetch_billing(days: int, kind: str = "pods", grouping: str = "gpuTypeId") -> list[dict[str, Any]]:
    """Historical per-day billing — survives pod/endpoint termination.

    kind: 'pods' (GPU pods) or 'endpoints' (serverless). Both contribute
    real spend and must be summed together for an accurate total — RunPod
    bills pods and serverless endpoints as separate line items, and an
    account can have spend in one with zero in the other.
    """
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    result = _rest_get(
        f"/billing/{kind}",
        params={
            "startTime": start,
            "endTime": end,
            "bucketSize": "day",
            "grouping": grouping,
        },
    )
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and "data" in result and isinstance(result["data"], list):
        logger.info("RunPod /billing/%s returned wrapped {data: [...]}, unwrapping", kind)
        return result["data"]
    logger.warning(
        "RunPod /billing/%s returned unexpected shape %s — treating as empty.",
        kind, type(result).__name__,
    )
    return []


def _fetch_billing_range(start_dt: datetime, end_dt: datetime, kind: str = "pods", grouping: str = "gpuTypeId") -> list[dict[str, Any]]:
    result = _rest_get(
        f"/billing/{kind}",
        params={
            "startTime": start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "endTime": end_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "bucketSize": "day",
            "grouping": grouping,
        },
    )
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and "data" in result and isinstance(result["data"], list):
        return result["data"]
    return []


def fetch_runpod_monthly_spend(year: int, month: int) -> dict[str, Any]:
    start_dt = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end_dt = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end_dt = datetime(year, month + 1, 1, tzinfo=timezone.utc)

    pod_rows = _fetch_billing_range(start_dt, end_dt, kind="pods")
    endpoint_rows = _fetch_billing_range(start_dt, end_dt, kind="endpoints")

    total = 0.0
    for row in pod_rows + endpoint_rows:
        total += row.get("amount") or 0.0

    return {
        "provider": "runpod",
        "year": year,
        "month": month,
        "total": round(total, 2),
        "currency": "USD",
    }


def fetch_runpod_data(days: int = 30) -> dict[str, Any]:
    active_pods = _fetch_active_pods()
    pod_billing_rows = _fetch_billing(days=days, kind="pods", grouping="gpuTypeId")
    serverless_billing_rows = _fetch_billing(days=days, kind="endpoints", grouping="endpointId")
    billing_rows = pod_billing_rows + serverless_billing_rows

    empty_data_reason = None
    running_count = sum(1 for p in active_pods if p.get("desiredStatus") == "RUNNING")
    stopped_with_storage = any(
        p.get("desiredStatus") != "RUNNING"
        and ((p.get("containerDiskInGb") or 0) > 0 or (p.get("volumeInGb") or 0) > 0)
        for p in active_pods
    )

    if not billing_rows:
        # Run a wider diagnostic check (90 days), across both pods and serverless
        try:
            wider_rows = (
                _fetch_billing(days=90, kind="pods")
                + _fetch_billing(days=90, kind="endpoints")
            )
        except Exception:
            wider_rows = []

        times = [row.get("time") for row in wider_rows if row.get("time")]
        last_time = max(times)[:10] if times else None

        if running_count > 0:
            empty_data_reason = RUNPOD_BILLING_PENDING
        elif stopped_with_storage:
            empty_data_reason = RUNPOD_STOPPED_STORAGE_NOTE
        elif last_time:
            empty_data_reason = (
                "No billing activity in this period. RunPod charges accrue only while a pod or serverless "
                f"endpoint is actively running — since none were active, there's nothing to bill. Last activity: {last_time}."
            )
        else:
            empty_data_reason = (
                "No billing activity in this period. RunPod charges accrue only while a pod or serverless "
                "endpoint is actively running — since none were active, there's nothing to bill."
            )

    daily_totals: dict[str, float] = {}
    daily_hours: dict[str, float] = {}
    gpu_costs: dict[str, float] = {}
    gpu_daily: dict[str, dict[str, float]] = {}  # {gpu_type: {date: amount}}
    endpoint_costs: dict[str, float] = {}
    endpoint_daily: dict[str, dict[str, float]] = {}

    for row in pod_billing_rows:
        day = (row.get("time") or "")[:10]
        amount = row.get("amount") or 0.0
        ms = row.get("timeBilledMs") or 0
        gpu = row.get("gpuTypeId") or "Unknown GPU"

        daily_totals[day] = daily_totals.get(day, 0.0) + amount
        daily_hours[day] = daily_hours.get(day, 0.0) + (ms / 3_600_000)
        gpu_costs[gpu] = gpu_costs.get(gpu, 0.0) + amount
        gpu_bucket = gpu_daily.setdefault(gpu, {})
        gpu_bucket[day] = gpu_bucket.get(day, 0.0) + amount

    for row in serverless_billing_rows:
        day = (row.get("time") or "")[:10]
        amount = row.get("amount") or 0.0
        ms = row.get("timeBilledMs") or 0
        endpoint = row.get("endpointId") or "Unknown endpoint"

        daily_totals[day] = daily_totals.get(day, 0.0) + amount
        daily_hours[day] = daily_hours.get(day, 0.0) + (ms / 3_600_000)
        endpoint_costs[endpoint] = endpoint_costs.get(endpoint, 0.0) + amount
        endpoint_daily.setdefault(endpoint, {})
        endpoint_daily[endpoint][day] = endpoint_daily[endpoint].get(day, 0.0) + amount

    # Zero-fill any days with no billing activity, up through today —
    # otherwise the series silently stops at the last day with real spend,
    # and "today" in the UI ends up pointing at stale data.
    today_utc = datetime.now(timezone.utc).date()
    if daily_totals:
        earliest = min(daily_totals.keys())
        start_date = datetime.strptime(earliest, "%Y-%m-%d").date()
        end_date = today_utc
        all_days = []
        d = start_date
        while d <= end_date:
            all_days.append(d.isoformat())
            d += timedelta(days=1)
    else:
        all_days = [today_utc.isoformat()]

    daily_series = [
        {"date": d, "value": round(daily_totals.get(d, 0.0), 2)}
        for d in all_days
    ]

    today_str = today_utc.isoformat()
    yesterday_str = (today_utc - timedelta(days=1)).isoformat()
    today_cost = round(daily_totals.get(today_str, 0.0), 2)
    yesterday_cost = round(daily_totals.get(yesterday_str, 0.0), 2)
    today_gpu_hours = round(daily_hours.get(today_str, 0.0), 2)

    month_str = today_utc.strftime("%Y-%m")
    mtd_total = round(sum(v for d, v in daily_totals.items() if d.startswith(month_str)), 2)

    # avg_per_day: mean over days that actually had spend (excludes today, which
    # may be incomplete). Falls back to 0 if there's no prior-day history yet.
    days_with_prior_spend = [v for d, v in daily_totals.items() if d != today_str and v > 0]
    avg_per_day = round(sum(days_with_prior_spend) / len(days_with_prior_spend), 4) if days_with_prior_spend else 0.0

    total_gpu_cost = sum(gpu_costs.values()) or 1.0
    gpu_breakdown = [
        {"name": name, "amount": round(amt, 2), "pct": round(amt / total_gpu_cost * 100, 1)}
        for name, amt in sorted(gpu_costs.items(), key=lambda kv: kv[1], reverse=True)
    ]

    total_endpoint_cost = sum(endpoint_costs.values()) or 1.0
    endpoint_breakdown = [
        {
            "name": name,
            "amount": round(amt, 2),
            "pct": round(amt / total_endpoint_cost * 100, 1),
            # Zero-filled day-by-day series for this endpoint, aligned to the
            # same date range as the account's main daily_series — powers a
            # per-endpoint sparkline in the UI.
            "daily_series": [
                {"date": d, "value": round(endpoint_daily.get(name, {}).get(d, 0.0), 2)}
                for d in all_days
            ],
        }
        for name, amt in sorted(endpoint_costs.items(), key=lambda kv: kv[1], reverse=True)
    ]

    now_utc = datetime.now(timezone.utc)
    pods_out = []
    for p in active_pods:
        cost_per_hr = p.get("costPerHr") or 0.0
        adjusted_cost_per_hr = p.get("adjustedCostPerHr") or cost_per_hr
        savings_per_hr = max(0.0, cost_per_hr - adjusted_cost_per_hr)

        # Uptime based on lastStartedAt
        last_started = p.get("lastStartedAt") or p.get("createdAt")
        uptime_sec = 0
        if last_started:
            try:
                started_dt = datetime.fromisoformat(last_started.replace("Z", "+00:00"))
                uptime_sec = int((now_utc - started_dt).total_seconds())
            except (ValueError, TypeError):
                uptime_sec = 0

        estimated_cost = round(adjusted_cost_per_hr * (uptime_sec / 3600), 2) if uptime_sec > 0 else 0.0

        # Bug fix: RunPod REST schema uses gpu.displayName, not gpu.name.
        # Fallback chain covers all documented + observed field variations.
        gpu_obj = p.get("gpu") or {}
        machine_obj = p.get("machine") or {}
        gpu_name = (
            gpu_obj.get("displayName")          # documented REST field (primary)
            or gpu_obj.get("name")              # some older API versions
            or machine_obj.get("gpuDisplayName") # machine-level fallback
            or machine_obj.get("gpuTypeId")     # last resort: raw type ID
            or "Unknown GPU"
        )
        gpu_count = gpu_obj.get("count") or machine_obj.get("gpuCount") or 1
        try:
            gpu_count = max(1, int(gpu_count))
        except (TypeError, ValueError):
            gpu_count = 1

        cost_per_gpu_hr = cost_per_hr / gpu_count
        adjusted_cost_per_gpu_hr = adjusted_cost_per_hr / gpu_count

        container_disk_gb = p.get("containerDiskInGb") or 0
        volume_disk_gb = p.get("volumeInGb") or 0
        total_disk_gb = container_disk_gb + volume_disk_gb

        interruptible = bool(p.get("interruptible"))

        pods_out.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "status": p.get("desiredStatus"),
            "cost_per_hr": cost_per_hr,
            "adjusted_cost_per_hr": adjusted_cost_per_hr,
            "savings_per_hr": round(savings_per_hr, 4),
            "cost_per_gpu_hr": round(cost_per_gpu_hr, 4),
            "adjusted_cost_per_gpu_hr": round(adjusted_cost_per_gpu_hr, 4),
            "gpu": gpu_name,
            "gpu_count": gpu_count,
            "uptime_seconds": uptime_sec,
            "estimated_cost": estimated_cost,
            "container_disk_gb": container_disk_gb,
            "volume_disk_gb": volume_disk_gb,
            "total_disk_gb": total_disk_gb,
            "interruptible": interruptible,
        })

    # Aggregated running pod metrics (Spot vs Secure split + savings plan details)
    running_pods = [pod for pod in pods_out if pod.get("status") == "RUNNING"]
    spot_count = sum(1 for pod in running_pods if pod.get("interruptible"))
    secure_count = sum(1 for pod in running_pods if not pod.get("interruptible"))
    spot_cost_per_hr = sum(pod.get("adjusted_cost_per_hr", 0.0) for pod in running_pods if pod.get("interruptible"))
    secure_cost_per_hr = sum(pod.get("adjusted_cost_per_hr", 0.0) for pod in running_pods if not pod.get("interruptible"))
    total_savings_per_hr = sum(pod.get("savings_per_hr", 0.0) for pod in running_pods)
    total_running_gpus = sum(pod.get("gpu_count", 1) for pod in running_pods)

    # Calculate last month same period
    import calendar
    if today_utc.month == 1:
        last_year = today_utc.year - 1
        last_month = 12
    else:
        last_year = today_utc.year
        last_month = today_utc.month - 1
        
    _, last_month_days = calendar.monthrange(last_year, last_month)
    last_day = min(today_utc.day, last_month_days)
    
    last_month_start_dt = datetime(last_year, last_month, 1, tzinfo=timezone.utc)
    last_month_end_dt = datetime(last_year, last_month, last_day, tzinfo=timezone.utc) + timedelta(days=1)
    
    try:
        last_pod_rows = _fetch_billing_range(last_month_start_dt, last_month_end_dt, kind="pods")
        last_endpoint_rows = _fetch_billing_range(last_month_start_dt, last_month_end_dt, kind="endpoints")
        last_month_same_period = sum(row.get("amount") or 0.0 for row in last_pod_rows + last_endpoint_rows)
    except Exception as exc:
        logger.warning("Failed to fetch prior month same period cost for RunPod: %s", exc)
        last_month_same_period = 0.0

    vs_last_month_pct = None
    if last_month_same_period and last_month_same_period > 0:
        vs_last_month_pct = round(((mtd_total - last_month_same_period) / last_month_same_period) * 100, 1)

    # Projected month end
    days_in_month = calendar.monthrange(today_utc.year, today_utc.month)[1]
    days_elapsed = today_utc.day
    projected_month_end = round((mtd_total / days_elapsed) * days_in_month, 2) if days_elapsed > 0 else 0.0

    # Possible idle pods (running GPU pods with uptime > 7 days)
    possible_idle_pods = [
        {
            "id": pod["id"],
            "name": pod["name"],
            "uptime_seconds": pod["uptime_seconds"],
            "cost_per_hr": pod["adjusted_cost_per_hr"],
            "gpu": pod["gpu"]
        }
        for pod in pods_out
        if pod["status"] == "RUNNING" and pod["uptime_seconds"] > 7 * 86400
    ]

    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly([d["value"] for d in daily_series], settings)
    anomaly_sma = detect_anomaly_sma([d["value"] for d in daily_series])

    if anomaly.is_anomaly or anomaly_sma.is_anomaly:
        anomaly_drivers = compute_drivers(gpu_daily, all_days, settings)
    else:
        anomaly_drivers = []
    return {
        "provider": "runpod",
        "today": today_cost,
        "yesterday": yesterday_cost,
        "avg_per_day": avg_per_day,
        "active_pods_count": running_count,
        "gpu_hours_today": today_gpu_hours,
        "month_to_date": mtd_total,
        "vs_last_month_pct": vs_last_month_pct,
        "projected_month_end": projected_month_end,
        "possible_idle_pods": possible_idle_pods,
        "daily_series": daily_series,
        "pods": pods_out,
        "gpu_breakdown": gpu_breakdown,
        "endpoint_breakdown": endpoint_breakdown,
        "anomaly": anomaly.__dict__,
        "anomaly_sma": anomaly_sma.__dict__,
        "anomaly_drivers": anomaly_drivers,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "empty_data_reason": empty_data_reason,
        # Aggregated stats
        "spot_count": spot_count,
        "secure_count": secure_count,
        "spot_cost_per_hr": round(spot_cost_per_hr, 4),
        "secure_cost_per_hr": round(secure_cost_per_hr, 4),
        "total_savings_per_hr": round(total_savings_per_hr, 4),
        "total_running_gpus": total_running_gpus,
    }