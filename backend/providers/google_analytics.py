"""
Google Analytics provider — pulls real daily event-volume data from the
GA4 Data API using a service account (must be added as a Viewer on the
GA4 property in Admin > Property Access Management).

GA4 itself doesn't bill in $ for standard properties — what you're tracking
here is event volume / quota usage, with an optional fixed "GA4 360" licence
cost set in .env for properties on the paid tier.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
from google.oauth2 import service_account

from anomaly import AnomalySettings, detect_anomaly
from config import app_config, ga4_config

logger = logging.getLogger("spendwatch.ga4")


def _client() -> BetaAnalyticsDataClient:
    if not ga4_config.service_account_json:
        raise RuntimeError("GA4_SERVICE_ACCOUNT_JSON_PATH missing in .env")
    creds = service_account.Credentials.from_service_account_file(
        ga4_config.service_account_json,
        scopes=["https://www.googleapis.com/auth/analytics.readonly"],
    )
    return BetaAnalyticsDataClient(credentials=creds)


def _daily_events(client: BetaAnalyticsDataClient, days: int = 30) -> tuple[list[dict[str, Any]], dict[str, float]]:
    request = RunReportRequest(
        property=f"properties/{ga4_config.property_id}",
        dimensions=[Dimension(name="date"), Dimension(name="platform")],
        metrics=[Metric(name="eventCount")],
        date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="today")],
    )
    response = client.run_report(request)

    by_date: dict[str, float] = {}
    by_platform: dict[str, float] = {}
    for row in response.rows:
        raw_date = row.dimension_values[0].value  # YYYYMMDD
        platform = row.dimension_values[1].value
        events = float(row.metric_values[0].value)
        formatted = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
        by_date[formatted] = by_date.get(formatted, 0.0) + events
        by_platform[platform] = by_platform.get(platform, 0.0) + events

    sorted_days = sorted(by_date.keys())
    series = [{"date": d, "value": by_date[d]} for d in sorted_days]
    return series, by_platform


def fetch_ga4_data() -> dict[str, Any]:
    client = _client()
    daily_series, by_platform = _daily_events(client)

    values = [d["value"] for d in daily_series]
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=1000,  # event-count delta, not dollars
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly(values, settings)

    today_events = values[-1] if values else 0.0
    avg_events = round(sum(values) / len(values), 0) if values else 0.0

    total_platform = sum(by_platform.values()) or 1.0
    platforms = [
        {"name": name, "events": amt, "pct": round(amt / total_platform * 100, 1)}
        for name, amt in sorted(by_platform.items(), key=lambda kv: kv[1], reverse=True)
    ]

    # GA4 has no official public "quota" percentage via API for standard tier;
    # use the documented free-tier event limit (10M/month) as the reference quota.
    monthly_limit = 10_000_000
    today_month_total = sum(
        d["value"] for d in daily_series if d["date"].startswith(date.today().strftime("%Y-%m"))
    )
    quota_pct = round(today_month_total / monthly_limit * 100, 1)

    return {
        "provider": "ga4",
        "monthly_license_cost": ga4_config.monthly_license_cost,
        "events_today": today_events,
        "avg_events_per_day": avg_events,
        "quota_pct": quota_pct,
        "active_platforms": len(by_platform),
        "daily_series": daily_series,
        "platforms": platforms,
        "anomaly": anomaly.__dict__,
    }
