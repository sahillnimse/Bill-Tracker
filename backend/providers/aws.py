"""
AWS provider — pulls real cost data from AWS Cost Explorer.

Requires an IAM user/role with ce:GetCostAndUsage permission. Cost Explorer
data has up to ~24h latency, which is normal and expected.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import boto3

from anomaly import AnomalySettings, compute_sma_series, detect_anomaly
from config import aws_config, app_config

logger = logging.getLogger("spendwatch.aws")


def _client():
    if not aws_config.access_key_id or not aws_config.secret_access_key:
        raise RuntimeError(
            "AWS credentials missing. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env"
        )
    return boto3.client(
        "ce",  # Cost Explorer is a global endpoint, but boto3 still wants a region
        region_name="us-east-1",
        aws_access_key_id=aws_config.access_key_id,
        aws_secret_access_key=aws_config.secret_access_key,
    )


def _daily_cost_by_service(start: date, end: date) -> dict[str, dict[str, float]]:
    """Returns {date_str: {service_name: cost}} for the given range (end exclusive)."""
    ce = _client()
    paginator_token = None
    results: dict[str, dict[str, float]] = {}

    while True:
        kwargs: dict[str, Any] = dict(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="DAILY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )
        if paginator_token:
            kwargs["NextPageToken"] = paginator_token

        resp = ce.get_cost_and_usage(**kwargs)
        for period in resp["ResultsByTime"]:
            day = period["TimePeriod"]["Start"]
            results.setdefault(day, {})
            for group in period["Groups"]:
                service = group["Keys"][0]
                amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
                results[day][service] = results[day].get(service, 0.0) + amount

        paginator_token = resp.get("NextPageToken")
        if not paginator_token:
            break

    return results


def _monthly_cost_by_dimension(start: date, end: date, dimension: str, limit: int = 8) -> list[dict[str, Any]]:
    ce = _client()
    paginator_token = None
    totals: dict[str, float] = {}

    while True:
        kwargs: dict[str, Any] = dict(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
            Granularity="MONTHLY",
            Metrics=["UnblendedCost"],
            GroupBy=[{"Type": "DIMENSION", "Key": dimension}],
        )
        if paginator_token:
            kwargs["NextPageToken"] = paginator_token

        resp = ce.get_cost_and_usage(**kwargs)
        for period in resp["ResultsByTime"]:
            for group in period["Groups"]:
                name = group["Keys"][0] or "Unattributed"
                amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
                if amount > 0:
                    totals[name] = totals.get(name, 0.0) + amount

        paginator_token = resp.get("NextPageToken")
        if not paginator_token:
            break

    total = sum(totals.values()) or 1.0
    return [
        {"name": name, "amount": round(amount, 2), "pct": round(amount / total * 100, 1)}
        for name, amount in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)[:limit]
    ]


def _month_end_forecast(today: date) -> dict[str, Any]:
    first_next_month = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    if today >= first_next_month:
        return {"amount": 0.0, "note": "Forecast unavailable at month boundary"}

    resp = _client().get_cost_forecast(
        TimePeriod={"Start": today.isoformat(), "End": first_next_month.isoformat()},
        Metric="UNBLENDED_COST",
        Granularity="MONTHLY",
        PredictionIntervalLevel=80,
    )
    forecast_total = float(resp.get("Total", {}).get("Amount", 0.0))
    return {
        "amount": round(forecast_total, 2),
        "unit": resp.get("Total", {}).get("Unit", "USD"),
    }


def _commitment_utilization(start: date, end: date) -> dict[str, Any]:
    ce = _client()
    result: dict[str, Any] = {
        "savings_plans": None,
        "reservations": None,
        "notes": [],
    }

    try:
        sp_resp = ce.get_savings_plans_utilization(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()}
        )
        total = sp_resp.get("Total", {})
        result["savings_plans"] = {
            "utilization_pct": round(float(total.get("UtilizationPercentage", 0.0)), 1),
            "net_savings": round(float(total.get("NetSavings", 0.0)), 2),
            "on_demand_cost_equivalent": round(float(total.get("OnDemandCostEquivalent", 0.0)), 2),
        }
    except Exception as exc:
        logger.warning("Savings Plans utilization unavailable: %s", exc)
        result["notes"].append("Savings Plans utilization unavailable")

    try:
        ri_resp = ce.get_reservation_utilization(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()}
        )
        total = ri_resp.get("Total", {})
        result["reservations"] = {
            "utilization_pct": round(float(total.get("UtilizationPercentage", 0.0)), 1),
            "purchased_hours": round(float(total.get("PurchasedHours", 0.0)), 2),
            "used_hours": round(float(total.get("UsedHours", 0.0)), 2),
            "unused_hours": round(float(total.get("UnusedHours", 0.0)), 2),
        }
    except Exception as exc:
        logger.warning("Reservation utilization unavailable: %s", exc)
        result["notes"].append("Reservation utilization unavailable")

    return result


    
def fetch_aws_data(days: int = 30) -> dict[str, Any]:
    today = date.today()
    start = today - timedelta(days=days)
    # CE end date is exclusive, and "today" usually isn't finalized yet,
    # so we request through tomorrow to make sure today's partial data shows.
    daily = _daily_cost_by_service(start, today + timedelta(days=1))

    sorted_days = sorted(daily.keys())
    daily_totals = [round(sum(daily[d].values()), 2) for d in sorted_days]

    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly(daily_totals, settings)

    today_str = sorted_days[-1] if sorted_days else today.isoformat()
    yesterday_total = daily_totals[-2] if len(daily_totals) >= 2 else 0.0
    today_total = daily_totals[-1] if daily_totals else 0.0

    # Month-to-date = sum of days within current calendar month
    mtd_days = [d for d in sorted_days if d.startswith(today.strftime("%Y-%m"))]
    mtd_total = round(sum(sum(daily[d].values()) for d in mtd_days), 2)

    # Service breakdown for the current month
    month_start = today.replace(day=1)
    query_end = today + timedelta(days=1)
    service_totals: dict[str, float] = {}
    for d in mtd_days:
        for svc, amt in daily[d].items():
            service_totals[svc] = service_totals.get(svc, 0.0) + amt
    top_services = sorted(service_totals.items(), key=lambda kv: kv[1], reverse=True)[:6]
    total_svc = sum(service_totals.values()) or 1.0

    avg_per_day = round(sum(daily_totals) / len(daily_totals), 2) if daily_totals else 0.0

    raw_daily_series = [{"date": d, "value": round(sum(daily[d].values()), 2)} for d in sorted_days]
    daily_series = compute_sma_series(raw_daily_series, short_window=7, long_window=20)

    diagnostics: dict[str, Any] = {}
    linked_accounts: list[dict[str, Any]] = []
    usage_types: list[dict[str, Any]] = []
    forecast = {"amount": 0.0, "note": "Forecast unavailable"}
    commitment_utilization = {"savings_plans": None, "reservations": None, "notes": []}

    try:
        linked_accounts = _monthly_cost_by_dimension(month_start, query_end, "LINKED_ACCOUNT")
    except Exception as exc:
        logger.warning("AWS linked account breakdown unavailable: %s", exc)
        diagnostics["linked_accounts"] = "Linked account breakdown unavailable"

    try:
        usage_types = _monthly_cost_by_dimension(month_start, query_end, "USAGE_TYPE", limit=10)
    except Exception as exc:
        logger.warning("AWS usage type breakdown unavailable: %s", exc)
        diagnostics["usage_types"] = "Usage type breakdown unavailable"

    try:
        forecast = _month_end_forecast(today)
    except Exception as exc:
        logger.warning("AWS cost forecast unavailable: %s", exc)
        diagnostics["forecast"] = "Forecast unavailable"

    try:
        commitment_utilization = _commitment_utilization(month_start, query_end)
    except Exception as exc:
        logger.warning("AWS commitment utilization unavailable: %s", exc)
        diagnostics["commitment_utilization"] = "Commitment utilization unavailable"

    return {
        "provider": "aws",
        "today": today_total,
        "yesterday": yesterday_total,
        "month_to_date": mtd_total,
        "avg_per_day_30d": avg_per_day,
        "daily_series": daily_series,
        "services": [
            {"name": name, "amount": round(amt, 2), "pct": round(amt / total_svc * 100, 1)}
            for name, amt in top_services
        ],
        "linked_accounts": linked_accounts,
        "usage_types": usage_types,
        "forecast_month_end": forecast,
        "commitment_utilization": commitment_utilization,
        "diagnostics": diagnostics,
        "anomaly": anomaly.__dict__,
        "region": aws_config.region,
        "as_of_date": today_str,
    }
