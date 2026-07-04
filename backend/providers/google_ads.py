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

    diagnostics: dict[str, str] = {}

    daily_query = """
        SELECT segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions
        FROM customer
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY segments.date ASC
    """
    daily_rows = _run_query(client, daily_query)

    daily_series = []
    cpc_trend = []
    cpm_trend = []
    total_conversions = 0.0
    total_conv_value = 0.0
    total_cost = 0.0
    total_clicks = 0
    total_impressions = 0
    for row in daily_rows:
        cost = row.metrics.cost_micros / 1_000_000
        daily_series.append({"date": row.segments.date, "value": round(cost, 2)})
        clicks = row.metrics.clicks or 0
        impressions = row.metrics.impressions or 0
        cpc_trend.append({
            "date": row.segments.date,
            "value": round(cost / clicks, 4) if clicks else 0.0,
        })
        cpm_trend.append({
            "date": row.segments.date,
            "value": round((cost / impressions) * 1000, 4) if impressions else 0.0,
        })
        total_conversions += row.metrics.conversions
        total_conv_value += row.metrics.conversions_value
        total_cost += cost
        total_clicks += clicks
        total_impressions += impressions

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
    avg_cpc = round(total_cost / total_clicks, 4) if total_clicks else 0.0
    avg_cpm = round((total_cost / total_impressions) * 1000, 4) if total_impressions else 0.0

    campaign_query = """
        SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.average_cpc, metrics.clicks
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
                "avg_cpc": round((r.metrics.average_cpc or 0) / 1_000_000, 4),
                "clicks": r.metrics.clicks,
                "roas": round(r.metrics.conversions_value / cost, 2) if cost > 0 else 0.0,
            }
        )

    network_breakdown: list[dict[str, Any]] = []
    try:
        network_query = """
            SELECT segments.ad_network_type, metrics.cost_micros, metrics.conversions
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS
            ORDER BY metrics.cost_micros DESC
        """
        network_rows = _run_query(client, network_query)
        network_totals: dict[str, dict[str, float]] = {}
        for r in network_rows:
            name = r.segments.ad_network_type.name.replace("_", " ").title()
            entry = network_totals.setdefault(name, {"amount": 0.0, "conversions": 0.0})
            entry["amount"] += r.metrics.cost_micros / 1_000_000
            entry["conversions"] += r.metrics.conversions
        total_network_cost = sum(v["amount"] for v in network_totals.values()) or 1.0
        network_breakdown = [
            {
                "name": name,
                "amount": round(v["amount"], 2),
                "pct": round(v["amount"] / total_network_cost * 100, 1),
                "conversions": round(v["conversions"], 1),
            }
            for name, v in sorted(network_totals.items(), key=lambda kv: kv[1]["amount"], reverse=True)
        ]
    except Exception as exc:
        logger.warning("Google Ads network breakdown unavailable: %s", exc)
        diagnostics["network_breakdown"] = "Network breakdown unavailable"

    rank_loss: list[dict[str, Any]] = []
    try:
        rank_query = """
            SELECT campaign.name, metrics.cost_micros, metrics.search_rank_lost_impression_share, metrics.search_budget_lost_impression_share
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS
            ORDER BY metrics.search_rank_lost_impression_share DESC
            LIMIT 8
        """
        rank_rows = _run_query(client, rank_query)
        for r in rank_rows:
            cost = r.metrics.cost_micros / 1_000_000
            rank_lost = r.metrics.search_rank_lost_impression_share
            budget_lost = r.metrics.search_budget_lost_impression_share
            if cost > 0 and (rank_lost or budget_lost):
                rank_loss.append({
                    "name": r.campaign.name,
                    "amount": round(cost, 2),
                    "rank_lost_pct": round((rank_lost or 0) * 100, 1),
                    "budget_lost_pct": round((budget_lost or 0) * 100, 1),
                })
    except Exception as exc:
        logger.warning("Google Ads rank/budget loss unavailable: %s", exc)
        diagnostics["rank_loss"] = "Rank/budget loss unavailable"

    wasted_spend: list[dict[str, Any]] = []
    try:
        wasted_query = """
            SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.clicks
            FROM campaign
            WHERE segments.date DURING LAST_30_DAYS
              AND metrics.cost_micros > 0
              AND metrics.conversions = 0
            ORDER BY metrics.cost_micros DESC
            LIMIT 10
        """
        wasted_rows = _run_query(client, wasted_query)
        wasted_spend = [
            {
                "name": r.campaign.name,
                "amount": round(r.metrics.cost_micros / 1_000_000, 2),
                "clicks": r.metrics.clicks,
                "conversions": r.metrics.conversions,
            }
            for r in wasted_rows
        ]
    except Exception as exc:
        logger.warning("Google Ads wasted spend query unavailable: %s", exc)
        diagnostics["wasted_spend"] = "Wasted spend query unavailable"

    return {
        "provider": "google_ads",
        "today": round(today_spend, 2),
        "month_to_date": mtd_spend,
        "roas": roas,
        "avg_cpc": avg_cpc,
        "avg_cpm": avg_cpm,
        "total_conversions_30d": round(total_conversions, 0),
        "daily_series": daily_series,
        "cpc_trend": cpc_trend,
        "cpm_trend": cpm_trend,
        "campaigns": campaigns,
        "network_breakdown": network_breakdown,
        "rank_loss": rank_loss,
        "wasted_spend": wasted_spend,
        "diagnostics": diagnostics,
        "anomaly": anomaly.__dict__,
    }
