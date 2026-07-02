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
    service_totals: dict[str, float] = {}
    for d in mtd_days:
        for svc, amt in daily[d].items():
            service_totals[svc] = service_totals.get(svc, 0.0) + amt
    top_services = sorted(service_totals.items(), key=lambda kv: kv[1], reverse=True)[:6]
    total_svc = sum(service_totals.values()) or 1.0

    avg_per_day = round(sum(daily_totals) / len(daily_totals), 2) if daily_totals else 0.0

    raw_daily_series = [{"date": d, "value": round(sum(daily[d].values()), 2)} for d in sorted_days]
    daily_series = compute_sma_series(raw_daily_series, short_window=7, long_window=20)

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
        "anomaly": anomaly.__dict__,
        "region": aws_config.region,
        "as_of_date": today_str,
    }