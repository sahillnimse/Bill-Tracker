"""
SpendWatch backend — FastAPI app exposing cached, provider-normalized cost
data to the React frontend, plus a /sync endpoint that re-fetches from the
real provider APIs and runs anomaly detection / email alerts.

Run with:
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import alerts
from cache import (
    get_anomaly_history,
    get_provider_cache,
    get_setting,
    init_db,
    record_anomaly,
    set_provider_cache,
    set_setting,
)
from config import app_config
from providers import aws as aws_provider
from providers import google_ads as google_ads_provider
from providers import google_analytics as ga4_provider
from providers import google_workspace as gworkspace_provider
from providers import microsoft365 as ms365_provider
from providers import runpod as runpod_provider

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spendwatch.main")

app = FastAPI(title="SpendWatch API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[app_config.cors_origin, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

PROVIDERS = {
    "aws": aws_provider.fetch_aws_data,
    "runpod": runpod_provider.fetch_runpod_data,
    "ga4": ga4_provider.fetch_ga4_data,
    "google_ads": google_ads_provider.fetch_google_ads_data,
    "ms365": ms365_provider.fetch_ms365_data,
    "gworkspace": gworkspace_provider.fetch_gworkspace_data,
}

ANOMALY_LABELS = {
    "aws": "AWS",
    "runpod": "RunPod",
    "ga4": "Google Analytics",
    "google_ads": "Google Ads",
    "ms365": "Microsoft 365",
    "gworkspace": "Google Workspace",
}

# Providers whose fetch functions accept a `days` parameter
DAYS_AWARE_PROVIDERS = {"gworkspace"}


def _fetch_and_cache(provider_key: str, days: int = 30) -> dict[str, Any]:
    fetch_fn = PROVIDERS[provider_key]
    try:
        if provider_key in DAYS_AWARE_PROVIDERS:
            data = fetch_fn(days=days)
        else:
            data = fetch_fn()
        data["_status"] = "ok"
    except Exception as exc:
        logger.exception("Failed to fetch %s", provider_key)
        cached = get_provider_cache(provider_key)
        if cached:
            cached["_status"] = "stale"
            cached["_error"] = str(exc)
            return cached
        return {"provider": provider_key, "_status": "error", "_error": str(exc)}

    anomaly = data.get("anomaly")
    if anomaly and anomaly.get("is_anomaly"):
        message = (
            f"{ANOMALY_LABELS.get(provider_key, provider_key)} anomaly: "
            f"today ${anomaly['today_value']} vs baseline ${anomaly['baseline_mean']} "
            f"({anomaly['pct_vs_baseline']:+.1f}%, z={anomaly['z_score']})"
        )
        record_anomaly(
            provider_key,
            datetime.now(timezone.utc).date().isoformat(),
            message,
            anomaly["z_score"],
        )
        alerts.send_anomaly_email(provider_key, f"{ANOMALY_LABELS.get(provider_key)} cost anomaly", message)

    set_provider_cache(provider_key, data)
    return data


def _get_provider_data(provider_key: str, force_refresh: bool = False, days: int = 30) -> dict[str, Any]:
    if not force_refresh:
        cached = get_provider_cache(provider_key, max_age_seconds=app_config.cache_ttl_seconds)
        if cached:
            cached["_status"] = "cached"
            return cached
    return _fetch_and_cache(provider_key, days=days)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/overview")
def overview(days: int = 30) -> dict[str, Any]:
    """Aggregated snapshot across all providers for the Overview page."""
    data = {key: _get_provider_data(key, days=days) for key in PROVIDERS}

    today_total = sum(d.get("today", 0) or 0 for k, d in data.items() if k not in {"ga4", "gworkspace"})
    mtd_total = sum(d.get("month_to_date", 0) or d.get("monthly_cost", 0) or 0 for k, d in data.items() if k not in {"ga4"})
    anomalies = [
        {"provider": k, **d["anomaly"]}
        for k, d in data.items()
        if d.get("anomaly") and d["anomaly"].get("is_anomaly")
    ]

    days_left_in_month = 30 - datetime.now(timezone.utc).day
    projected_month_end = round(mtd_total + (today_total * max(days_left_in_month, 0)), 2)

    return {
        "providers": data,
        "today_total": round(today_total, 2),
        "month_to_date_total": round(mtd_total, 2),
        "projected_month_end": projected_month_end,
        "active_anomalies": anomalies,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/provider/{provider_key}")
def provider_detail(provider_key: str, days: int = 30) -> dict[str, Any]:
    if provider_key not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider '{provider_key}'")
    return _get_provider_data(provider_key, days=days)


@app.post("/api/sync")
def sync_all(days: int = 30) -> dict[str, Any]:
    """Force a fresh pull from every provider's live API."""
    results = {}
    for key in PROVIDERS:
        results[key] = _fetch_and_cache(key, days=days)
    return {"synced_at": datetime.now(timezone.utc).isoformat(), "providers": results}


@app.post("/api/sync/{provider_key}")
def sync_provider(provider_key: str, days: int = 30) -> dict[str, Any]:
    if provider_key not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider '{provider_key}'")
    return _fetch_and_cache(provider_key, days=days)


@app.get("/api/anomalies")
def anomalies(provider: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    return get_anomaly_history(provider, limit)


class SettingsPayload(BaseModel):
    z_score_threshold: float | None = None
    min_dollar_delta: float | None = None
    baseline_window_days: int | None = None
    smtp_sender_email: str | None = None
    alert_recipients: str | None = None


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return {
        "z_score_threshold": float(get_setting("z_score_threshold", str(app_config.z_score_threshold))),
        "min_dollar_delta": float(get_setting("min_dollar_delta", str(app_config.min_dollar_delta))),
        "baseline_window_days": int(get_setting("baseline_window_days", str(app_config.baseline_window_days))),
    }


@app.post("/api/settings")
def update_settings(payload: SettingsPayload) -> dict[str, str]:
    for field, value in payload.model_dump(exclude_none=True).items():
        set_setting(field, str(value))
    return {"status": "saved"}
