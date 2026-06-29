"""
Google Ads provider — pulls real campaign-level spend, conversions, and ROAS
from the Google Ads API using OAuth2 (refresh token flow) + a developer token.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from google.ads.googleads.client import GoogleAdsClient

from anomaly import AnomalySettings, detect_anomaly
from config import app_config, google_ads_config

logger = logging.getLogger("spendwatch.google_ads")


def _client() -> GoogleAdsClient:
    required = [
        google_ads_config.developer_token,
        google_ads_config.client_id,
        google_ads_config.client_secret,
        google_ads_config.refresh_token,
    ]
    if not all(required):
        raise RuntimeError(
            "Google Ads credentials incomplete. Check GOOGLE_ADS_* vars in .env"
        )
    config_dict = {
        "developer_token": google_ads_config.developer_token,
        "client_id": google_ads_config.client_id,
        "client_secret": google_ads_config.client_secret,
        "refresh_token": google_ads_config.refresh_token,
        "use_proto_plus": True,
    }
    if google_ads_config.login_customer_id:
        config_dict["login_customer_id"] = google_ads_config.login_customer_id
    return GoogleAdsClient.load_from_dict(config_dict)


def _run_query(client: GoogleAdsClient, query: str) -> list[Any]:
    ga_service = client.get_service("GoogleAdsService")
    response = ga_service.search(customer_id=google_ads_config.customer_id, query=query)
    return list(response)


def fetch_google_ads_data() -> dict[str, Any]:
    client = _client()

    daily_query = """
        SELECT segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value
        FROM customer
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY segments.date ASC
    """
    daily_rows = _run_query(client, daily_query)

    daily_series = []
    total_conversions = 0.0
    total_conv_value = 0.0
    total_cost = 0.0
    for row in daily_rows:
        cost = row.metrics.cost_micros / 1_000_000
        daily_series.append({"date": row.segments.date, "value": round(cost, 2)})
        total_conversions += row.metrics.conversions
        total_conv_value += row.metrics.conversions_value
        total_cost += cost

    values = [d["value"] for d in daily_series]
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly(values, settings)

    today_spend = values[-1] if values else 0.0
    month_str = date.today().strftime("%Y-%m")
    mtd_spend = round(sum(d["value"] for d in daily_series if d["date"].startswith(month_str)), 2)
    roas = round(total_conv_value / total_cost, 2) if total_cost > 0 else 0.0
    avg_cpc = None

    campaign_query = """
        SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.average_cpc
        FROM campaign
        WHERE segments.date DURING TODAY
        ORDER BY metrics.cost_micros DESC
    """
    campaign_rows = _run_query(client, campaign_query)
    campaigns = []
    total_today_cost = sum(r.metrics.cost_micros for r in campaign_rows) or 1
    for r in campaign_rows:
        cost = r.metrics.cost_micros / 1_000_000
        campaigns.append(
            {
                "name": r.campaign.name,
                "amount": round(cost, 2),
                "pct": round(r.metrics.cost_micros / total_today_cost * 100, 1),
                "conversions": r.metrics.conversions,
                "roas": round(r.metrics.conversions_value / cost, 2) if cost > 0 else 0.0,
            }
        )

    return {
        "provider": "google_ads",
        "today": round(today_spend, 2),
        "month_to_date": mtd_spend,
        "roas": roas,
        "total_conversions_30d": round(total_conversions, 0),
        "daily_series": daily_series,
        "campaigns": campaigns,
        "anomaly": anomaly.__dict__,
    }
