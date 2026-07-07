"""
RunPod provider — pulls billing + live pod status via RunPod's REST API.

RunPod's GraphQL `myself.pods` and REST `/v1/pods` only list pods that are
CURRENTLY running — once a pod is stopped/terminated, it vanishes from both,
even though it was billed real money while it ran. So this provider uses:
  - REST `/v1/billing/pods` as the source of truth for spend (works whether
    or not anything is running right now, and survives pod termination)
  - REST `/v1/pods` only for "how many pods are running right now" (a live
    status count, separate from historical billing)
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from anomaly import AnomalySettings, detect_anomaly
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


def _fetch_billing(days: int) -> list[dict[str, Any]]:
    """Historical per-day, per-GPU-type billing — survives pod termination."""
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    end = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    result = _rest_get(
        "/billing/pods",
        params={
            "startTime": start,
            "endTime": end,
            "bucketSize": "day",
            "grouping": "gpuTypeId",
        },
    )
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and "data" in result and isinstance(result["data"], list):
        logger.info("RunPod /billing/pods returned wrapped {data: [...]}, unwrapping")
        return result["data"]
    logger.warning(
        "RunPod /billing/pods returned unexpected shape %s — treating as empty.",
        type(result).__name__,
    )
    return []


def fetch_runpod_data(days: int = 30) -> dict[str, Any]:
    active_pods = _fetch_active_pods()
    billing_rows = _fetch_billing(days=days)

    empty_data_reason = None
    running_count = sum(1 for p in active_pods if p.get("desiredStatus") == "RUNNING")
    stopped_with_storage = any(
        p.get("desiredStatus") != "RUNNING"
        and ((p.get("containerDiskInGb") or 0) > 0 or (p.get("volumeInGb") or 0) > 0)
        for p in active_pods
    )

    if not billing_rows:
        # Run a wider diagnostic check (90 days)
        try:
            wider_rows = _fetch_billing(days=90)
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
                "No billing activity in this period. RunPod charges accrue only while a pod is actively running "
                f"— since no pods were active, there's nothing to bill. Last activity: {last_time}."
            )
        else:
            empty_data_reason = (
                "No billing activity in this period. RunPod charges accrue only while a pod is actively running "
                "— since no pods were active, there's nothing to bill."
            )

    daily_totals: dict[str, float] = {}
    daily_hours: dict[str, float] = {}
    gpu_costs: dict[str, float] = {}

    for row in billing_rows:
        day = (row.get("time") or "")[:10]
        amount = row.get("amount") or 0.0
        ms = row.get("timeBilledMs") or 0
        gpu = row.get("gpuTypeId") or "Unknown GPU"

        daily_totals[day] = daily_totals.get(day, 0.0) + amount
        daily_hours[day] = daily_hours.get(day, 0.0) + (ms / 3_600_000)
        gpu_costs[gpu] = gpu_costs.get(gpu, 0.0) + amount

    # Zero-fill any days with no billing activity, up through today —
    # otherwise the series silently stops at the last day with real spend,
    # and "today" in the UI ends up pointing at stale data.
    if daily_totals:
        earliest = min(daily_totals.keys())
        start_date = datetime.strptime(earliest, "%Y-%m-%d").date()
        end_date = date.today()
        all_days = []
        d = start_date
        while d <= end_date:
            all_days.append(d.isoformat())
            d += timedelta(days=1)
    else:
        all_days = [date.today().isoformat()]

    daily_series = [
        {"date": d, "value": round(daily_totals.get(d, 0.0), 2)}
        for d in all_days
    ]

    today_str = date.today().isoformat()
    today_cost = round(daily_totals.get(today_str, 0.0), 2)
    today_gpu_hours = round(daily_hours.get(today_str, 0.0), 2)

    month_str = date.today().strftime("%Y-%m")
    mtd_total = round(sum(v for d, v in daily_totals.items() if d.startswith(month_str)), 2)

    total_gpu_cost = sum(gpu_costs.values()) or 1.0
    gpu_breakdown = [
        {"name": name, "amount": round(amt, 2), "pct": round(amt / total_gpu_cost * 100, 1)}
        for name, amt in sorted(gpu_costs.items(), key=lambda kv: kv[1], reverse=True)
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

    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly([d["value"] for d in daily_series], settings)

    return {
        "provider": "runpod",
        "today": today_cost,
        "active_pods_count": running_count,
        "gpu_hours_today": today_gpu_hours,
        "month_to_date": mtd_total,
        "daily_series": daily_series,
        "pods": pods_out,
        "gpu_breakdown": gpu_breakdown,
        "anomaly": anomaly.__dict__,
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
