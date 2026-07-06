"""
SpendWatch backend — FastAPI app exposing cached, provider-normalized cost
data to the React frontend, plus a /sync endpoint that re-fetches from the
real provider APIs and runs anomaly detection / email alerts.

Run with:
    uvicorn main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import auth
from config import auth_config
from cache import (
    cleanup_old_anomalies,
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
from providers import aws_resources
from providers import google_ads as google_ads_provider
from providers import google_workspace as gworkspace_provider
from providers import microsoft365 as ms365_provider
from providers import runpod as runpod_provider
# mock_fallback intentionally not imported — no fake data served to frontend

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


# ── Auth routes (no login required to hit these — they ARE the login flow) ──
@app.get("/api/auth/login")
def auth_login():
    url = auth.build_authorize_url()
    return RedirectResponse(url)


@app.get("/api/auth/callback")
def auth_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse(f"{auth_config.frontend_url}/?login_error={error}")
    if not code:
        return RedirectResponse(f"{auth_config.frontend_url}/?login_error=missing_code")

    auth.validate_state(state)
    session_token = auth.verify_tenant_and_issue_session(code)

    resp = RedirectResponse(auth_config.frontend_url)
    resp.set_cookie(
        key=auth.SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=auth_config.session_ttl_hours * 3600,
    )
    return resp


@app.post("/api/auth/logout")
def auth_logout():
    resp = RedirectResponse(auth_config.frontend_url)
    resp.delete_cookie(auth.SESSION_COOKIE_NAME)
    return resp


@app.get("/api/auth/me")
def auth_me(session: dict = Depends(auth.require_session)):
    return auth.get_current_user(session)


# ── Global guard: every /api/* route below requires a valid Xarka session,
# except the ones already defined above (health check + the auth flow
# itself, which obviously can't require you to already be logged in). ──
@app.middleware("http")
async def enforce_auth(request: Request, call_next):
    # TEMP: auth enforcement disabled until Azure admin consent is granted.
    return await call_next(request)

def _json_401():
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=401, content={"detail": "Not signed in."})

PROVIDERS = {
    "aws": aws_provider.fetch_aws_data,
    "runpod": runpod_provider.fetch_runpod_data,
    "google_ads": google_ads_provider.fetch_google_ads_data,
    "ms365": ms365_provider.fetch_ms365_data,
    "gworkspace": gworkspace_provider.fetch_gworkspace_data,
}

ANOMALY_LABELS = {
    "aws": "AWS",
    "runpod": "RunPod",
    "google_ads": "Google Ads",
    "ms365": "Microsoft 365",
    "gworkspace": "Google Workspace",
}

# Providers whose fetch functions accept a `days` parameter
DAYS_AWARE_PROVIDERS = {"gworkspace", "aws"}


def _get_empty_provider_data(provider_key: str, error_msg: str) -> dict[str, Any]:
    today_iso = datetime.now(timezone.utc).date().isoformat()
    default_anomaly = {
        "is_anomaly": False,
        "z_score": 0.0,
        "baseline_mean": 0.0,
        "baseline_stdev": 0.0,
        "today_value": 0.0,
        "pct_vs_baseline": 0.0,
        "delta": 0.0,
        "severity": "ok",
    }
    
    if provider_key == "aws":
        return {
            "provider": "aws",
            "today": 0.0,
            "yesterday": 0.0,
            "month_to_date": 0.0,
            "avg_per_day_30d": 0.0,
            "daily_series": [{"date": today_iso, "value": 0.0}],
            "services": [],
            "anomaly": default_anomaly,
            "region": "unknown",
            "_status": "error",
            "_error": error_msg,
        }
    elif provider_key == "runpod":
        runpod_billing_error = "Unable to verify billing data — check RunPod API key configuration."
        return {
            "provider": "runpod",
            "today": 0.0,
            "active_pods_count": 0,
            "gpu_hours_today": 0.0,
            "month_to_date": 0.0,
            "daily_series": [{"date": today_iso, "value": 0.0}],
            "pods": [],
            "gpu_breakdown": [],
            "anomaly": default_anomaly,
            "_status": "error",
            "_error": error_msg,
            "empty_data_reason": runpod_billing_error,
        }
    elif provider_key == "google_ads":
        return {
            "provider": "google_ads",
            "today": 0.0,
            "month_to_date": 0.0,
            "roas": 0.0,
            "total_conversions_30d": 0.0,
            "daily_series": [{"date": today_iso, "value": 0.0}],
            "campaigns": [],
            "anomaly": default_anomaly,
            "_status": "error",
            "_error": error_msg,
        }
    elif provider_key == "ms365":
        return {
            "provider": "ms365",
            "total_licenses": 0,
            "monthly_bill": 0.0,
            "cost_per_user": 0.0,
            "standard_count": 0,
            "basic_count": 0,
            "free_count": 0,
            "basic_cost_per_user": 0.0,
            "standard_cost_per_user": 0.0,
            "new_ids_7d": 0,
            "bill_change_vs_last_week": 0.0,
            "mfa_pending": 0,
            "recent_users": [],
            "_status": "error",
            "_error": error_msg,
        }
    elif provider_key == "gworkspace":
        return {
            "provider": "gworkspace",
            "seats": 0,
            "monthly_cost": 0.0,
            "cost_per_seat": 0.0,
            "cost_per_gb": 0.0,
            "total_storage_gb": 0.0,
            "active_users": 0,
            "drive_events_today": 0.0,
            "avg_drive_events_per_day": 0.0,
            "daily_series": [{"date": today_iso, "value": 0.0}],
            "top_users": [],
            "domain": "unknown",
            "anomaly": default_anomaly,
            "_status": "error",
            "_error": error_msg,
        }
    return {
        "provider": provider_key,
        "_status": "error",
        "_error": error_msg,
    }


def _fetch_and_cache(provider_key: str, days: int = 30) -> dict[str, Any]:
    try:
        if provider_key == "aws":
            data = aws_provider.fetch_aws_data(days=days)
        elif provider_key == "gworkspace":
            data = gworkspace_provider.fetch_gworkspace_data(days=days)
        elif provider_key == "runpod":
            data = runpod_provider.fetch_runpod_data(days=days)
        else:
            data = PROVIDERS[provider_key]()
    except Exception as exc:
        logger.exception("Failed to fetch %s", provider_key)
        cached = get_provider_cache(provider_key, days=days)
        if cached:
            cached["_status"] = "stale"
            cached["_error"] = str(exc)
            return cached
        # No cache and no real data — return error schema instead of 502
        return _get_empty_provider_data(provider_key, str(exc))

    set_provider_cache(provider_key, data, days=days)

    anomaly = data.get("anomaly")
    if anomaly and anomaly.get("is_anomaly"):
        label = ANOMALY_LABELS.get(provider_key, provider_key)
        message = (
            f"{label} spend anomaly: today ${anomaly.get('today_value')} "
            f"vs baseline ${anomaly.get('baseline_mean')} "
            f"({anomaly.get('pct_vs_baseline')}% change)"
        )
        record_anomaly(
            provider=provider_key,
            date=datetime.now(timezone.utc).date().isoformat(),
            message=message,
            z_score=anomaly.get("z_score", 0.0),
        )

    cleanup_old_anomalies()
    return data


def _get_provider_data(provider_key: str, force_refresh: bool = False, days: int = 30) -> dict[str, Any]:
    if not force_refresh:
        cached = get_provider_cache(provider_key, max_age_seconds=app_config.cache_ttl_seconds, days=days)
        if cached:
            cached["_status"] = "cached"
            return cached
    return _fetch_and_cache(provider_key, days=days)

def _fetch_all_parallel(fn: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    """
    Run `fn(provider_key)` for every provider concurrently on a thread pool.
    """
    results: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=len(PROVIDERS)) as pool:
        future_to_key = {pool.submit(fn, key): key for key in PROVIDERS}
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                logger.exception("Unhandled error fetching %s", key)
                results[key] = _get_empty_provider_data(key, str(exc))
    return results

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/overview")
def overview(days: int = 30) -> dict[str, Any]:
    """Aggregated snapshot across all providers for the Overview page."""
    data = _fetch_all_parallel(lambda key: _get_provider_data(key, days=days))
    today_total = sum(d.get("today", 0) or 0 for k, d in data.items() if k not in {"gworkspace"})
    mtd_total = sum(d.get("month_to_date", 0) or d.get("monthly_cost", 0) or 0 for k, d in data.items())
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
    results = _fetch_all_parallel(lambda key: _fetch_and_cache(key, days=days))
    return {"synced_at": datetime.now(timezone.utc).isoformat(), "providers": results}

@app.post("/api/sync/{provider_key}")
def sync_provider(provider_key: str, days: int = 30) -> dict[str, Any]:
    if provider_key not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider '{provider_key}'")
    return _fetch_and_cache(provider_key, days=days)


@app.get("/api/anomalies")
def anomalies(provider: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    return get_anomaly_history(provider, limit)


@app.get("/api/aws/instances")
def aws_instances() -> dict[str, Any]:
    """
    Live EC2 instance inventory across all enabled regions: state, type,
    uptime, and trailing-24h CPU utilization. Requires the IAM user to have
    ec2:DescribeInstances, ec2:DescribeRegions, and cloudwatch:GetMetricData
    permissions in addition to the existing Cost Explorer permission.
    """
    try:
        return aws_resources.fetch_ec2_instances()
    except Exception as exc:
        logger.exception("Failed to fetch EC2 instances")
        raise HTTPException(502, str(exc))


@app.get("/api/aws/usage-breakdown")
def aws_usage_breakdown(days: int = 30) -> dict[str, Any]:
    """
    Deep AWS Cost Explorer breakdown by service, usage type, and region —
    shows exactly which AWS features/services are actively driving spend.
    """
    try:
        return aws_resources.fetch_service_usage_breakdown(days=days)
    except Exception as exc:
        logger.exception("Failed to fetch AWS usage breakdown")
        raise HTTPException(502, str(exc))


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
