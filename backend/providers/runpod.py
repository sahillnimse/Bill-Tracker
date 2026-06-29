"""
RunPod provider — pulls live pod status + cost data via RunPod's GraphQL API.

RunPod doesn't expose a clean historical daily-billing endpoint, so this
combines:
  - `myself { pods {...} }` for currently running pods (real-time cost rate)
  - locally accumulated daily totals (stored in SQLite) built by summing
    pod runtime * cost/hr each time /sync runs, since RunPod's billing API
    does not provide a simple per-day historical series.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx

from anomaly import AnomalySettings, detect_anomaly
from cache import get_conn
from config import app_config, runpod_config

logger = logging.getLogger("spendwatch.runpod")

RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql"

PODS_QUERY = """
query Pods {
  myself {
    pods {
      id
      name
      desiredStatus
      costPerHr
      machine { gpuDisplayName }
      runtime { uptimeInSeconds }
    }
  }
}
"""


def _ensure_history_table() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runpod_daily (
                date TEXT PRIMARY KEY,
                total_cost REAL NOT NULL,
                gpu_hours REAL NOT NULL
            )
            """
        )
        conn.commit()


def _fetch_pods() -> list[dict[str, Any]]:
    if not runpod_config.api_key:
        raise RuntimeError("RUNPOD_API_KEY missing in .env")

    resp = httpx.post(
        RUNPOD_GRAPHQL_URL,
        params={"api_key": runpod_config.api_key},
        json={"query": PODS_QUERY},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    if "errors" in data:
        raise RuntimeError(f"RunPod API error: {data['errors']}")
    return data["data"]["myself"]["pods"] or []


def _record_today_snapshot(pods: list[dict[str, Any]]) -> None:
    """Accumulate today's running-cost estimate into the local daily history table."""
    _ensure_history_table()
    today_str = date.today().isoformat()
    today_cost = sum((p.get("costPerHr") or 0) * (p.get("runtime", {}).get("uptimeInSeconds", 0) or 0) / 3600 for p in pods)
    today_gpu_hours = sum((p.get("runtime", {}).get("uptimeInSeconds", 0) or 0) / 3600 for p in pods if p.get("desiredStatus") == "RUNNING")

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO runpod_daily (date, total_cost, gpu_hours) VALUES (?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET total_cost=excluded.total_cost, gpu_hours=excluded.gpu_hours",
            (today_str, round(today_cost, 2), round(today_gpu_hours, 2)),
        )
        conn.commit()


def _get_daily_history(limit_days: int = 30) -> list[dict[str, Any]]:
    _ensure_history_table()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT date, total_cost, gpu_hours FROM runpod_daily ORDER BY date DESC LIMIT ?",
            (limit_days,),
        ).fetchall()
    rows.reverse()
    return [{"date": r[0], "value": r[1], "gpu_hours": r[2]} for r in rows]


def fetch_runpod_data() -> dict[str, Any]:
    pods = _fetch_pods()
    _record_today_snapshot(pods)
    history = _get_daily_history()

    daily_totals = [d["value"] for d in history]
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly(daily_totals, settings)

    today_data = history[-1] if history else {"value": 0.0, "gpu_hours": 0.0}
    month_str = date.today().strftime("%Y-%m")
    mtd_total = round(sum(d["value"] for d in history if d["date"].startswith(month_str)), 2)

    # GPU type breakdown from currently running pods
    gpu_costs: dict[str, float] = {}
    active_pods = []
    for p in pods:
        gpu_name = (p.get("machine") or {}).get("gpuDisplayName", "Unknown GPU")
        uptime_hr = (p.get("runtime", {}).get("uptimeInSeconds", 0) or 0) / 3600
        cost = (p.get("costPerHr") or 0) * uptime_hr
        gpu_costs[gpu_name] = gpu_costs.get(gpu_name, 0.0) + cost
        active_pods.append(
            {
                "id": p.get("id"),
                "name": p.get("name") or gpu_name,
                "status": p.get("desiredStatus"),
                "cost_per_hr": p.get("costPerHr"),
                "uptime_seconds": p.get("runtime", {}).get("uptimeInSeconds", 0) if p.get("runtime") else 0,
                "estimated_cost": round(cost, 2),
            }
        )

    total_gpu_cost = sum(gpu_costs.values()) or 1.0
    gpu_breakdown = [
        {"name": name, "amount": round(amt, 2), "pct": round(amt / total_gpu_cost * 100, 1)}
        for name, amt in sorted(gpu_costs.items(), key=lambda kv: kv[1], reverse=True)
    ]

    running_count = sum(1 for p in pods if p.get("desiredStatus") == "RUNNING")

    return {
        "provider": "runpod",
        "today": today_data["value"],
        "active_pods_count": running_count,
        "gpu_hours_today": today_data.get("gpu_hours", 0.0),
        "month_to_date": mtd_total,
        "daily_series": [{"date": d["date"], "value": d["value"]} for d in history],
        "pods": active_pods,
        "gpu_breakdown": gpu_breakdown,
        "anomaly": anomaly.__dict__,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
