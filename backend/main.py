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
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import auth
from config import auth_config
from cache import (
    add_allowed_user,
    cleanup_expired_revocations,
    cleanup_old_anomalies,
    get_anomaly_history,
    get_provider_cache,
    get_setting,
    init_db,
    list_allowed_users,
    record_anomaly,
    set_provider_cache,
    set_setting,
)
from config import app_config
from providers import aws as aws_provider
from providers import aws_resources
from providers import google_ads as google_ads_provider
from providers import microsoft365 as ms365_provider
from providers import runpod as runpod_provider
from providers import e2e_networks as e2e_provider
# mock_fallback intentionally not imported — no fake data served to frontend

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spendwatch.main")
logger.info(
    "AUTH CONFIG CHECK — cross_origin=%s frontend_url=%s",
    auth_config.cross_origin, auth_config.frontend_url,
)

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
class EnrollStartPayload(BaseModel):
    email: str


class EnrollConfirmPayload(BaseModel):
    email: str
    code: str


class LoginPayload(BaseModel):
    email: str
    code: str


def _set_session_cookie(resp: JSONResponse, session_token: str) -> None:
    resp.set_cookie(
        key=auth.SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        samesite="none" if auth_config.cross_origin else "lax",
        secure=auth_config.cross_origin,
        max_age=auth_config.session_ttl_hours * 3600,
    )


@app.post("/api/auth/enroll/start")
def auth_enroll_start(payload: EnrollStartPayload):
    return auth.start_enrollment(payload.email)


@app.post("/api/auth/enroll/confirm")
def auth_enroll_confirm(payload: EnrollConfirmPayload):
    session_token = auth.confirm_enrollment(payload.email, payload.code)
    resp = JSONResponse({"ok": True})
    _set_session_cookie(resp, session_token)
    return resp


@app.post("/api/auth/login")
def auth_login(payload: LoginPayload):
    session_token = auth.verify_login(payload.email, payload.code)
    resp = JSONResponse({"ok": True})
    _set_session_cookie(resp, session_token)
    return resp


@app.post("/api/auth/logout")
def auth_logout(session: dict = Depends(auth.require_session)):
    auth.revoke_current_session(session)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(
        auth.SESSION_COOKIE_NAME,
        samesite="none" if auth_config.cross_origin else "lax",
        secure=auth_config.cross_origin,
    )
    return resp


@app.get("/api/auth/me")
def auth_me(session: dict = Depends(auth.require_session)):
    return auth.get_current_user(session)


# ── Admin: manage the allowlist from a deployed instance with no shell access ──
class AddUserPayload(BaseModel):
    email: str
    name: str


@app.post("/api/admin/bootstrap")
def admin_bootstrap(payload: AddUserPayload) -> dict[str, Any]:
    """One-time, no-login-required way to add the very first allowlist user
    after a fresh/empty DB (e.g. right after the Postgres migration). Only
    works while allowed_users is completely empty — once anyone exists, this
    always 403s and you must use the logged-in /api/admin/users route."""
    if list_allowed_users():
        raise HTTPException(
            status_code=403,
            detail="Allowlist is not empty — use /api/admin/users (requires login) instead.",
        )
    email = payload.email.lower().strip()
    name = payload.name.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    add_allowed_user(email, name)
    return {"ok": True, "email": email, "name": name}


@app.get("/api/admin/users")
def admin_list_users(session: dict = Depends(auth.require_session)) -> list[dict[str, Any]]:
    return list_allowed_users()


@app.post("/api/admin/users")
def admin_add_user(payload: AddUserPayload, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    email = payload.email.lower().strip()
    name = payload.name.strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    added = add_allowed_user(email, name)
    if not added:
        raise HTTPException(status_code=409, detail=f"'{email}' is already on the allowlist.")
    return {"ok": True, "email": email, "name": name}


PROVIDERS = {
    "aws": aws_provider.fetch_aws_data,
    "runpod": runpod_provider.fetch_runpod_data,
    "e2e": e2e_provider.fetch_e2e_data,
    "google_ads": google_ads_provider.fetch_google_ads_data,
    "ms365": ms365_provider.fetch_ms365_data,
}

ANOMALY_LABELS = {
    "aws": "AWS",
    "runpod": "RunPod",
    "e2e": "E2E Networks",
    "google_ads": "Google Ads",
    "ms365": "Microsoft 365",
}

# Providers whose fetch functions accept a `days` parameter
DAYS_AWARE_PROVIDERS = {"aws", "google_ads", "e2e"}


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
            "total_conversions_period": 0.0,
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
    elif provider_key == "e2e":
        return {
            "provider": "e2e",
            "today": 0.0,
            "active_nodes_count": 0,
            "gpu_hours_today": 0.0,
            "cpu_hours_today": 0.0,
            "month_to_date": 0.0,
            "daily_series": [{"date": today_iso, "value": 0.0}],
            "nodes": [],
            "node_breakdown": [],
            "anomaly": default_anomaly,
            "_status": "error",
            "_error": error_msg,
            "empty_data_reason": "Unable to verify billing data — check E2E Networks API key configuration.",
            "free_tier_hours_used": 0.0,
            "free_tier_hours_remaining": 2.0,
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
        elif provider_key == "runpod":
            data = runpod_provider.fetch_runpod_data(days=days)
        elif provider_key == "e2e":
            data = e2e_provider.fetch_e2e_data(days=days)
        elif provider_key == "google_ads":
            data = google_ads_provider.fetch_google_ads_data(days=days)
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

    label = ANOMALY_LABELS.get(provider_key, provider_key)
    daily_series = data.get("daily_series")
    if daily_series:
        today_date = daily_series[-1]["date"]
    else:
        today_date = datetime.now(timezone.utc).date().isoformat()

    anomaly = data.get("anomaly")
    if anomaly and anomaly.get("is_anomaly"):
        message = (
            f"{label} spend anomaly (z-score): today {anomaly.get('today_value')} "
            f"vs baseline {anomaly.get('baseline_mean')} "
            f"({anomaly.get('pct_vs_baseline')}% change)"
        )
        record_anomaly(
            provider=provider_key,
            date=today_date,
            message=message,
            z_score=anomaly.get("z_score", 0.0),
            method="z_score",
        )

    anomaly_sma = data.get("anomaly_sma")
    if anomaly_sma and anomaly_sma.get("is_anomaly"):
        message = (
            f"{label} spend anomaly (SMA 7/20): today {anomaly_sma.get('today_value')} "
            f"vs SMA20 baseline {anomaly_sma.get('baseline_mean')} "
            f"({anomaly_sma.get('pct_vs_baseline')}% change)"
        )
        record_anomaly(
            provider=provider_key,
            date=today_date,
            message=message,
            z_score=anomaly_sma.get("z_score", 0.0),
            method="sma",
        )

    cleanup_old_anomalies()
    cleanup_expired_revocations()
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
def overview(days: int = 30, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    """Aggregated snapshot across all providers for the Overview page."""
    data = _fetch_all_parallel(lambda key: _get_provider_data(key, days=days))
    # All active providers report spend normalized to USD by their fetch functions.
    # ms365 is included but contributes 0 to today/MTD totals because it returns
    # monthly_bill (INR) rather than a today/month_to_date key — harmless.
    USD_SPEND_PROVIDERS = {"aws", "runpod", "google_ads", "ms365"}
    today_total = sum(
        d.get("today", 0) or 0
        for k, d in data.items()
        if k in USD_SPEND_PROVIDERS
    )
    mtd_total = sum(
        d.get("month_to_date", 0) or d.get("monthly_cost", 0) or 0
        for k, d in data.items()
        if k in USD_SPEND_PROVIDERS
    )
    all_anomalies = get_anomaly_history(limit=20)
    today_str = datetime.now(timezone.utc).date().isoformat()
    yesterday_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    anomalies = [a for a in all_anomalies if a["date"] in (today_str, yesterday_str)]

    days_left_in_month = 30 - datetime.now(timezone.utc).day
    projected_month_end = round(mtd_total + (today_total * max(days_left_in_month, 0)), 2)

    # Calculate biggest mover over the last 7 days across all providers
    movers = []
    for key, pdata in data.items():
        series = pdata.get("daily_series") or pdata.get("license_trend")
        if not series or len(series) < 7:
            continue
        
        val_key = "value" if "daily_series" in pdata else "monthly_bill"
        today_val = series[-1].get(val_key, 0.0)
        prev_val = series[-7].get(val_key, 0.0)
        
        if prev_val and prev_val > 0:
            pct_change = round(((today_val - prev_val) / prev_val) * 100, 1)
            movers.append({
                "provider": key,
                "pct_change": pct_change,
                "abs_change": abs(pct_change)
            })
            
    biggest_mover = None
    if movers:
        movers.sort(key=lambda x: x["abs_change"], reverse=True)
        biggest_mover = {
            "provider": movers[0]["provider"],
            "pct_change": movers[0]["pct_change"]
        }

    return {
        "providers": data,
        "today_total": round(today_total, 2),
        "month_to_date_total": round(mtd_total, 2),
        "projected_month_end": projected_month_end,
        "active_anomalies": anomalies,
        "biggest_mover": biggest_mover,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/provider/{provider_key}")
def provider_detail(provider_key: str, days: int = 30, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    if provider_key not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider '{provider_key}'")
    return _get_provider_data(provider_key, days=days)


@app.get("/api/provider/{provider_key}/monthly")
def provider_monthly_spend(provider_key: str, year: int, month: int, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    if provider_key == "aws":
        return aws_provider.fetch_aws_monthly_spend(year, month)
    if provider_key == "runpod":
        return runpod_provider.fetch_runpod_monthly_spend(year, month)
    if provider_key == "e2e":
        return e2e_provider.fetch_e2e_monthly_spend(year, month)
    if provider_key == "google_ads":
        return google_ads_provider.fetch_google_ads_monthly_spend(year, month)
    raise HTTPException(404, f"Monthly spend not supported for '{provider_key}'")


@app.post("/api/sync")
def sync_all(days: int = 30, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    """Force a fresh pull from every provider's live API."""
    results = _fetch_all_parallel(lambda key: _fetch_and_cache(key, days=days))
    return {"synced_at": datetime.now(timezone.utc).isoformat(), "providers": results}

@app.post("/api/sync/{provider_key}")
def sync_provider(provider_key: str, days: int = 30, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    if provider_key not in PROVIDERS:
        raise HTTPException(404, f"Unknown provider '{provider_key}'")
    return _fetch_and_cache(provider_key, days=days)


@app.get("/api/anomalies")
def anomalies(provider: str | None = None, limit: int = 20, session: dict = Depends(auth.require_session)) -> list[dict[str, Any]]:
    return get_anomaly_history(provider, limit)


@app.get("/api/aws/instances")
def aws_instances(session: dict = Depends(auth.require_session)) -> dict[str, Any]:
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
def aws_usage_breakdown(days: int = 30, session: dict = Depends(auth.require_session)) -> dict[str, Any]:
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
def get_settings(session: dict = Depends(auth.require_session)) -> dict[str, Any]:
    return {
        "z_score_threshold": float(get_setting("z_score_threshold", str(app_config.z_score_threshold))),
        "min_dollar_delta": float(get_setting("min_dollar_delta", str(app_config.min_dollar_delta))),
        "baseline_window_days": int(get_setting("baseline_window_days", str(app_config.baseline_window_days))),
    }


@app.post("/api/settings")
def update_settings(payload: SettingsPayload, session: dict = Depends(auth.require_session)) -> dict[str, str]:
    for field, value in payload.model_dump(exclude_none=True).items():
        set_setting(field, str(value))
    return {"status": "saved"}


# ── Background Scheduler (Automatic Cache Warming) ──
scheduler = BackgroundScheduler()


def _refresh_all_providers() -> None:
    logger.info("Starting background parallel provider cache refresh...")
    try:
        # Fetch and cache all providers in parallel using the existing ThreadPoolExecutor helper
        _fetch_all_parallel(lambda key: _fetch_and_cache(key))
        logger.info("Background provider refresh completed successfully")
    except Exception:
        logger.exception("Background provider refresh failed")


@app.on_event("startup")
def start_scheduler() -> None:
    # Warm the cache immediately on boot so cold starts are eliminated right after deploy/restarts
    _refresh_all_providers()
    
    interval = max(app_config.cache_ttl_seconds - 30, 60)
    logger.info("Registering background cache scheduler with interval of %d seconds", interval)
    
    scheduler.add_job(
        _refresh_all_providers,
        "interval",
        seconds=interval,
        id="refresh_all_providers",
        replace_existing=True,
        max_instances=1,  # prevent overlapping refreshes if APIs run slow
    )
    scheduler.start()


@app.on_event("shutdown")
def stop_scheduler() -> None:
    logger.info("Stopping background cache scheduler...")
    scheduler.shutdown()