"""
Standalone Google Ads raw data pull — bypasses the app entirely.
Run this from inside backend/ with the venv active (same folder as .env),
so it reuses your existing GOOGLE_ADS_* credentials automatically.

Usage:
  python gads_raw_pull.py            # last 30 days, daily granularity
  python gads_raw_pull.py --days 7   # last 7 days
"""
import argparse
import json
from datetime import date, timedelta

from google.ads.googleads.client import GoogleAdsClient
from config import google_ads_config


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=30)
    args = p.parse_args()

    config_dict = {
        "developer_token": google_ads_config.developer_token,
        "client_id": google_ads_config.client_id,
        "client_secret": google_ads_config.client_secret,
        "refresh_token": google_ads_config.refresh_token,
        "use_proto_plus": True,
    }
    if google_ads_config.login_customer_id:
        config_dict["login_customer_id"] = google_ads_config.login_customer_id

    client = GoogleAdsClient.load_from_dict(config_dict)
    ga_service = client.get_service("GoogleAdsService")

    today = date.today()
    start = today - timedelta(days=args.days)

    # Daily spend + conversions, no campaign grouping — top-level ground truth
    query = f"""
        SELECT
            segments.date,
            metrics.cost_micros,
            metrics.conversions,
            metrics.clicks,
            metrics.impressions
        FROM customer
        WHERE segments.date BETWEEN '{start.isoformat()}' AND '{today.isoformat()}'
        ORDER BY segments.date
    """

    # Fetch the account's native billing currency — cost_micros is always in
    # this currency, NOT USD. The main app (google_ads.py) converts this to
    # USD internally using a live exchange rate; this standalone script does
    # NOT do that conversion, so we must label the output honestly or it
    # will be misread as USD ground truth (as happened before this fix).
    currency_code = "UNKNOWN"
    try:
        currency_rows = list(ga_service.search(
            customer_id=google_ads_config.customer_id,
            query="SELECT customer.currency_code FROM customer LIMIT 1",
        ))
        if currency_rows:
            currency_code = currency_rows[0].customer.currency_code or "UNKNOWN"
    except Exception:
        pass

    rows = list(ga_service.search(customer_id=google_ads_config.customer_id, query=query))

    daily = {}
    for row in rows:
        d = row.segments.date
        cost = row.metrics.cost_micros / 1_000_000
        daily.setdefault(d, {"cost": 0.0, "conversions": 0.0, "clicks": 0, "impressions": 0})
        daily[d]["cost"] += cost
        daily[d]["conversions"] += row.metrics.conversions
        daily[d]["clicks"] += row.metrics.clicks
        daily[d]["impressions"] += row.metrics.impressions

    out = {
        "customer_id": google_ads_config.customer_id,
        "cost_currency": currency_code,
        "cost_currency_note": f"All 'cost' values below are in {currency_code}, NOT USD.",
        "daily": daily,
    }
    with open("gads_raw_full.json", "w") as f:
        json.dump(out, f, indent=2)

    print(f"Saved gads_raw_full.json — {len(daily)} days")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()