"""
Google Ads provider — pulls real campaign-level spend, conversions, and ROAS
from the Google Ads API using OAuth2 (refresh token flow) + a developer token.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
import httpx

from google.ads.googleads.client import GoogleAdsClient

from anomaly import AnomalySettings, compute_drivers, detect_anomaly, compute_sma_series, detect_anomaly_sma
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


def fetch_google_ads_monthly_spend(year: int, month: int) -> dict[str, Any]:
    client = _client()

    currency_code = "USD"
    try:
        currency_query = "SELECT customer.currency_code FROM customer LIMIT 1"
        currency_rows = _run_query(client, currency_query)
        if currency_rows:
            currency_code = currency_rows[0].customer.currency_code or "USD"
    except Exception:
        pass

    exchange_rate = 1.0
    if currency_code != "USD":
        try:
            resp = httpx.get("https://open.er-api.com/v6/latest/USD", timeout=5)
            if resp.status_code == 200:
                rate = resp.json().get("rates", {}).get(currency_code)
                if rate:
                    exchange_rate = float(rate)
        except Exception:
            fallbacks = {"INR": 84.0, "EUR": 0.92, "GBP": 0.78}
            exchange_rate = fallbacks.get(currency_code, 1.0)

    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(year, month + 1, 1) - timedelta(days=1)

    monthly_query = f"""
        SELECT metrics.cost_micros
        FROM customer
        WHERE segments.date BETWEEN '{start_date.strftime("%Y-%m-%d")}' AND '{end_date.strftime("%Y-%m-%d")}'
    """
    rows = _run_query(client, monthly_query)
    total = sum((r.metrics.cost_micros / 1_000_000) / exchange_rate for r in rows)

    return {
        "provider": "google_ads",
        "year": year,
        "month": month,
        "total": round(total, 2),
        "currency": "USD",
    }


def fetch_google_ads_data(days: int = 30) -> dict[str, Any]:
    client = _client()

    diagnostics: dict[str, str] = {}

    # 1. Fetch customer currency code and timezone
    currency_code = "USD"
    time_zone = "UTC"
    try:
        currency_query = "SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1"
        currency_rows = _run_query(client, currency_query)
        if currency_rows:
            currency_code = currency_rows[0].customer.currency_code or "USD"
            time_zone = currency_rows[0].customer.time_zone or "UTC"
    except Exception as exc:
        logger.warning("Failed to fetch customer currency and timezone: %s", exc)
        diagnostics["currency_fetch"] = f"Failed to fetch currency: {exc}"

    # 2. Get USD exchange rate for this currency code
    exchange_rate = 1.0
    if currency_code != "USD":
        try:
            resp = httpx.get("https://open.er-api.com/v6/latest/USD", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                rate = data.get("rates", {}).get(currency_code)
                if rate:
                     exchange_rate = float(rate)
                     logger.info("Fetched exchange rate for %s: %s", currency_code, exchange_rate)
        except Exception as exc:
            logger.warning("Failed to fetch exchange rate for %s: %s. Using fallback.", currency_code, exc)
            diagnostics["exchange_rate_fetch"] = f"Exchange rate fetch error, using fallback. {exc}"
            fallbacks = {"INR": 84.0, "EUR": 0.92, "GBP": 0.78}
            exchange_rate = fallbacks.get(currency_code, 1.0)

    # Determine local date in Google Ads customer's configured timezone
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(time_zone)
    except Exception:
        from datetime import timezone
        tz = timezone.utc
    today_tz = datetime.now(tz).date()

    # Calculate dynamic start and end dates
    end_date = (today_tz - timedelta(days=1)).strftime("%Y-%m-%d")
    start_date = (today_tz - timedelta(days=days)).strftime("%Y-%m-%d")

    daily_query = f"""
        SELECT segments.date, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.clicks, metrics.impressions
        FROM customer
        WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
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
        # Convert cost from local currency to USD
        cost = (row.metrics.cost_micros / 1_000_000) / exchange_rate
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
        total_conv_value += (row.metrics.conversions_value or 0.0) / exchange_rate
        total_cost += cost
        total_clicks += clicks
        total_impressions += impressions

    daily_series = compute_sma_series(daily_series, short_window=7, long_window=20)
    cpc_trend = compute_sma_series(cpc_trend, short_window=7, long_window=20)
    values = [d["value"] for d in daily_series]
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly(values, settings)
    anomaly_sma = detect_anomaly_sma(values)
    # Use the actual today date in customer timezone to look up today's spend in the series
    today_str = today_tz.isoformat()
    today_spend_map = {d["date"]: d["value"] for d in daily_series}
    today_spend = today_spend_map.get(today_str, values[-1] if values else 0.0)

    month_str = today_tz.strftime("%Y-%m")
    mtd_spend = round(sum(d["value"] for d in daily_series if d["date"].startswith(month_str)), 2)
    roas = round(total_conv_value / total_cost, 2) if total_cost > 0 else 0.0
    # Store as separate names so the campaign loop cannot overwrite these
    overall_avg_cpc = round(total_cost / total_clicks, 4) if total_clicks else 0.0
    overall_avg_cpm = round((total_cost / total_impressions) * 1000, 4) if total_impressions else 0.0

    latest_date_str = daily_series[-1]["date"] if daily_series else today_tz.strftime("%Y-%m-%d")

    campaign_query = f"""
        SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.average_cpc, metrics.clicks
        FROM campaign
        WHERE segments.date = '{latest_date_str}'
        ORDER BY metrics.cost_micros DESC
    """
    campaign_rows = _run_query(client, campaign_query)
    campaigns = []
    total_today_cost = sum(r.metrics.cost_micros for r in campaign_rows) or 1
    for r in campaign_rows:
        cost = (r.metrics.cost_micros / 1_000_000) / exchange_rate
        # Use a LOCAL variable so the outer overall_avg_cpc is never overwritten
        campaign_avg_cpc = ((r.metrics.average_cpc or 0) / 1_000_000) / exchange_rate
        conv_val = (r.metrics.conversions_value or 0) / exchange_rate
        campaigns.append(
            {
                "name": r.campaign.name,
                "amount": round(cost, 2),
                "pct": round(r.metrics.cost_micros / total_today_cost * 100, 1),
                "conversions": r.metrics.conversions,
                "avg_cpc": round(campaign_avg_cpc, 4),
                "clicks": r.metrics.clicks,
                "roas": round(conv_val / cost, 2) if cost > 0 else 0.0,
            }
        )

    network_breakdown: list[dict[str, Any]] = []
    try:
        network_query = f"""
            SELECT segments.ad_network_type, metrics.cost_micros, metrics.conversions
            FROM campaign
            WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
            ORDER BY metrics.cost_micros DESC
        """
        network_rows = _run_query(client, network_query)
        network_totals: dict[str, dict[str, float]] = {}
        for r in network_rows:
            name = r.segments.ad_network_type.name.replace("_", " ").title()
            entry = network_totals.setdefault(name, {"amount": 0.0, "conversions": 0.0})
            entry["amount"] += (r.metrics.cost_micros / 1_000_000) / exchange_rate
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
        rank_query = f"""
            SELECT campaign.name, metrics.cost_micros, metrics.search_rank_lost_impression_share, metrics.search_budget_lost_impression_share
            FROM campaign
            WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
            ORDER BY metrics.search_rank_lost_impression_share DESC
            LIMIT 8
        """
        rank_rows = _run_query(client, rank_query)
        for r in rank_rows:
            cost = (r.metrics.cost_micros / 1_000_000) / exchange_rate
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
        wasted_query = f"""
            SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.clicks
            FROM campaign
            WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
              AND metrics.cost_micros > 0
              AND metrics.conversions = 0
            ORDER BY metrics.cost_micros DESC
            LIMIT 10
        """
        wasted_rows = _run_query(client, wasted_query)
        wasted_spend = [
            {
                "name": r.campaign.name,
                "amount": round((r.metrics.cost_micros / 1_000_000) / exchange_rate, 2),
                "clicks": r.metrics.clicks,
                "conversions": r.metrics.conversions,
            }
            for r in wasted_rows
        ]
    except Exception as exc:
        logger.warning("Google Ads wasted spend query unavailable: %s", exc)
        diagnostics["wasted_spend"] = "Wasted spend query unavailable"

    # Per-campaign daily series for driver attribution — only fetched when anomaly fired
    campaign_daily: dict[str, dict[str, float]] = {}
    if anomaly.is_anomaly or anomaly_sma.is_anomaly:
        try:
            campaign_daily_query = f"""
                SELECT campaign.name, segments.date, metrics.cost_micros
                FROM campaign
                WHERE segments.date BETWEEN '{start_date}' AND '{end_date}'
                ORDER BY segments.date ASC
            """
            for r in _run_query(client, campaign_daily_query):
                name = r.campaign.name
                d = r.segments.date
                cost = (r.metrics.cost_micros / 1_000_000) / exchange_rate
                bucket = campaign_daily.setdefault(name, {})
                bucket[d] = bucket.get(d, 0.0) + cost
        except Exception as exc:
            logger.warning("Google Ads campaign daily query for anomaly drivers unavailable: %s", exc)
            diagnostics["anomaly_drivers"] = "Campaign daily query unavailable"

    # Calculate last month same period
    import calendar
    if today_tz.month == 1:
        last_year = today_tz.year - 1
        last_month = 12
    else:
        last_year = today_tz.year
        last_month = today_tz.month - 1
        
    _, last_month_days = calendar.monthrange(last_year, last_month)
    last_day = min(today_tz.day, last_month_days)
    
    last_month_start = date(last_year, last_month, 1)
    last_month_end = date(last_year, last_month, last_day)

    try:
        last_month_start_str = last_month_start.strftime("%Y-%m-%d")
        last_month_end_str = last_month_end.strftime("%Y-%m-%d")
        last_month_query = f"""
            SELECT metrics.cost_micros
            FROM customer
            WHERE segments.date BETWEEN '{last_month_start_str}' AND '{last_month_end_str}'
        """
        last_rows = _run_query(client, last_month_query)
        last_month_same_period = sum((r.metrics.cost_micros / 1_000_000) / exchange_rate for r in last_rows)
    except Exception as exc:
        logger.warning("Failed to fetch prior month same period cost for Google Ads: %s", exc)
        last_month_same_period = 0.0

    vs_last_month_pct = None
    if last_month_same_period and last_month_same_period > 0:
        vs_last_month_pct = round(((mtd_spend - last_month_same_period) / last_month_same_period) * 100, 1)

    # Projected month end
    days_in_month = calendar.monthrange(today_tz.year, today_tz.month)[1]
    days_elapsed = today_tz.day
    projected_month_end = round((mtd_spend / days_elapsed) * days_in_month, 2) if days_elapsed > 0 else 0.0

    date_axis = [d["date"] for d in daily_series]
    if (anomaly.is_anomaly or anomaly_sma.is_anomaly) and campaign_daily:
        anomaly_drivers = compute_drivers(campaign_daily, date_axis, settings)
    else:
        anomaly_drivers = []

    return {
        "provider": "google_ads",
        "today": round(today_spend, 2),
        "month_to_date": mtd_spend,
        "vs_last_month_pct": vs_last_month_pct,
        "projected_month_end": projected_month_end,
        "roas": roas,
        "avg_cpc": overall_avg_cpc,
        "avg_cpm": overall_avg_cpm,
        "total_conversions_period": round(total_conversions, 0),
        "daily_series": daily_series,
        "cpc_trend": cpc_trend,
        "cpm_trend": cpm_trend,
        "campaigns": campaigns,
        "network_breakdown": network_breakdown,
        "rank_loss": rank_loss,
        "wasted_spend": wasted_spend,
        "diagnostics": diagnostics,
        "anomaly": anomaly.__dict__,
        "anomaly_sma": anomaly_sma.__dict__,
        "anomaly_drivers": anomaly_drivers,
    }
