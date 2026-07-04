"""
Google Workspace provider — pulls storage, Drive activity, and Gmail
usage data via the Google Admin SDK Reports API and Drive API.

Uses the same service account auth as GA4 — add the service account email
as a delegated admin (or grant it domain-wide delegation) in the Google
Workspace Admin Console.

Required scopes for the service account:
  https://www.googleapis.com/auth/admin.reports.usage.readonly
  https://www.googleapis.com/auth/admin.reports.audit.readonly

Set in .env:
  GWORKSPACE_ADMIN_EMAIL          — a real admin user to impersonate
  GWORKSPACE_SERVICE_ACCOUNT_JSON_PATH — same or separate service account JSON
  GWORKSPACE_SEATS                — number of licensed seats (for cost calc)
  GWORKSPACE_COST_PER_SEAT        — per-seat monthly cost (e.g. 12 for Business Starter)
  GWORKSPACE_DOMAIN               — your workspace domain (e.g. yourcompany.com)
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

from anomaly import AnomalySettings, detect_anomaly
from config import app_config, gworkspace_config

logger = logging.getLogger("spendwatch.gworkspace")

SCOPES = [
    "https://www.googleapis.com/auth/admin.reports.usage.readonly",
    "https://www.googleapis.com/auth/admin.reports.audit.readonly",
]


def _service(api_name: str, version: str):
    if not gworkspace_config.service_account_json:
        raise RuntimeError("GWORKSPACE_SERVICE_ACCOUNT_JSON_PATH missing in .env")
    if not gworkspace_config.admin_email:
        raise RuntimeError("GWORKSPACE_ADMIN_EMAIL missing in .env")

    creds = service_account.Credentials.from_service_account_file(
        gworkspace_config.service_account_json, scopes=SCOPES
    )
    # Domain-wide delegation: impersonate the admin user
    delegated = creds.with_subject(gworkspace_config.admin_email)
    return build(api_name, version, credentials=delegated, cache_discovery=False)


def _get_drive_activity(days: int) -> list[dict[str, Any]]:
    """Returns daily Drive file-access event counts for the last N days."""
    service = _service("admin", "reports_v1")
    series_by_date: dict[str, int] = {}

    today = date.today()
    start = today - timedelta(days=days)

    try:
        result = (
            service.activities()
            .list(
                userKey="all",
                applicationName="drive",
                startTime=start.isoformat() + "T00:00:00Z",
                maxResults=1000,
            )
            .execute()
        )
        for item in result.get("items", []):
            event_date = item.get("id", {}).get("time", "")[:10]
            if event_date:
                series_by_date[event_date] = series_by_date.get(event_date, 0) + 1
    except Exception as e:
        logger.warning("Drive activity fetch failed: %s", e)

    # Fill in all days so chart has no gaps
    filled = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        filled.append({"date": d, "value": float(series_by_date.get(d, 0))})

    return filled


def _get_user_usage(days: int) -> dict[str, Any]:
    """Returns aggregate user counts: active users, storage used, top users."""
    service = _service("admin", "reports_v1")
    today = date.today()
    report_date = (today - timedelta(days=2)).isoformat()  # Reports lag ~2 days

    total_storage_gb = 0.0
    active_users = 0
    total_emails_sent = 0
    top_users: list[dict] = []

    try:
        result = (
            service.userUsageReport()
            .get(
                userKey="all",
                date=report_date,
                parameters="drive:num_items_created,drive:storage_used_in_bytes,gmail:num_emails_sent,accounts:is_less_secure_apps_access_allowed",
            )
            .execute()
        )
        usage_reports = result.get("usageReports", [])

        for report in usage_reports:
            email = report.get("entity", {}).get("userEmail", "")
            params = {p["name"]: p.get("intValue", p.get("boolValue", "")) for p in report.get("parameters", [])}
            storage_bytes = int(params.get("drive:storage_used_in_bytes", 0) or 0)
            storage_gb = round(storage_bytes / (1024 ** 3), 2)
            emails_sent = int(params.get("gmail:num_emails_sent", 0) or 0)
            items_created = int(params.get("drive:num_items_created", 0) or 0)

            total_storage_gb += storage_gb
            total_emails_sent += emails_sent
            if emails_sent > 0 or items_created > 0:
                active_users += 1
            top_users.append({
                "email": email,
                "storage_gb": storage_gb,
                "emails_sent": emails_sent,
                "items_created": items_created,
            })

        top_users.sort(key=lambda u: u["storage_gb"], reverse=True)
        top_users = top_users[:8]

    except Exception as e:
        logger.warning("User usage report fetch failed: %s", e)

    return {
        "total_storage_gb": round(total_storage_gb, 2),
        "active_users": active_users,
        "total_emails_sent": total_emails_sent,
        "top_users": top_users,
        "top_email_users": sorted(top_users, key=lambda u: u["emails_sent"], reverse=True)[:8],
    }


def fetch_gworkspace_data(days: int = 30) -> dict[str, Any]:
    drive_series = _get_drive_activity(days)
    user_data = _get_user_usage(days)

    values = [d["value"] for d in drive_series]
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=50,  # event delta threshold, not dollars
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly(values, settings)

    seats = gworkspace_config.seats
    cost_per_seat = gworkspace_config.cost_per_seat
    monthly_cost = round(seats * cost_per_seat, 2)
    cost_per_gb = round(monthly_cost / max(user_data["total_storage_gb"], 1), 4)
    inactive_seats = max(seats - user_data["active_users"], 0)
    inactive_seat_cost = round(inactive_seats * cost_per_seat, 2)
    cost_per_active_user = round(monthly_cost / max(user_data["active_users"], 1), 2)

    today_activity = values[-1] if values else 0.0
    avg_activity = round(sum(values) / len(values), 1) if values else 0.0

    return {
        "provider": "gworkspace",
        "seats": seats,
        "monthly_cost": monthly_cost,
        "cost_per_seat": cost_per_seat,
        "cost_per_active_user": cost_per_active_user,
        "cost_per_gb": cost_per_gb,
        "total_storage_gb": user_data["total_storage_gb"],
        "active_users": user_data["active_users"],
        "inactive_seats": inactive_seats,
        "inactive_seat_cost": inactive_seat_cost,
        "total_emails_sent": user_data["total_emails_sent"],
        "drive_events_today": today_activity,
        "avg_drive_events_per_day": avg_activity,
        "daily_series": drive_series,
        "top_users": user_data["top_users"],
        "top_email_users": user_data["top_email_users"],
        "storage_split": {
            "personal_drive_gb": user_data["total_storage_gb"],
            "shared_drive_gb": None,
            "note": "Shared drive storage split is not available from the current Reports API pull.",
        },
        "domain": gworkspace_config.domain,
        "anomaly": anomaly.__dict__,
    }
