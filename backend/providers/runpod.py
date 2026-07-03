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
from cache import get_conn
from config import app_config, runpod_config

logger = logging.getLogger("spendwatch.runpod")

REST_BASE = "https://rest.runpod.io/v1"


def _rest_get(path: str, params: dict | None = None) -> Any:
    if not runpod_config.api_key:
        raise RuntimeError("RUNPOD_API_KEY missing in .env")

    resp = httpx.get(
        f"{REST_BASE}{path}",
        headers={"Authorization": f"Bearer {runpod_config.api_key}"},
        params=params or {},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _fetch_active_pods() -> list[dict[str, Any]]:
    """Live pod list — only reflects pods running right now."""
    result = _rest_get("/pods")
    return result if isinstance(result, list) else []


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
    return result if isinstance(result, list) else []


def fetch_runpod_data(days: int = 30) -> dict[str, Any]:
    active_pods = _fetch_active_pods()
    billing_rows = _fetch_billing(days=days)

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

    running_count = sum(1 for p in active_pods if p.get("desiredStatus") == "RUNNING")
    pods_out = [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "status": p.get("desiredStatus"),
            "cost_per_hr": p.get("costPerHr"),
            "gpu": ((p.get("machine") or {}).get("gpuDisplayName")),
        }
        for p in active_pods
    ]

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
    }
