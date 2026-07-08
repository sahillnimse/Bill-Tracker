"""
Standalone Microsoft Graph raw data pull — bypasses the app entirely.
Run this from inside backend/ with the venv active (same folder as .env),
so it reuses your existing MS365_* credentials automatically.

NOTE: Microsoft Graph does NOT expose real dollar billing. This script
pulls the same license/user data your app's provider uses, so you can
verify SEAT COUNTS are correct. The dollar amounts your app shows are
computed from these counts x per-seat prices YOU configured in .env
(MS365_BASIC_COST_PER_SEAT etc.) - those prices are only as correct as
what you typed in, not something Graph can verify for you.

Usage:
  python ms365_raw_pull.py
"""
import json
import msal
import httpx

from config import ms365_config

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


def get_token():
    app = msal.ConfidentialClientApplication(
        ms365_config.client_id,
        authority=f"https://login.microsoftonline.com/{ms365_config.tenant_id}",
        client_credential=ms365_config.client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        raise RuntimeError(f"MS Graph auth failed: {result.get('error_description')}")
    return result["access_token"]


def graph_get(token, path, params=None):
    headers = {"Authorization": f"Bearer {token}"}
    resp = httpx.get(f"{GRAPH_BASE}{path}", headers=headers, params=params or {}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    token = get_token()

    # 1. Subscribed SKUs - the real source of truth for license counts
    skus = graph_get(token, "/subscribedSkus")
    sku_summary = [
        {
            "skuPartNumber": s.get("skuPartNumber"),
            "consumedUnits": s.get("consumedUnits"),
            "enabled_units": s.get("prepaidUnits", {}).get("enabled"),
            "suspended_units": s.get("prepaidUnits", {}).get("suspended"),
        }
        for s in skus.get("value", [])
    ]

    # 2. Total user count
    users = graph_get(token, "/users", params={"$select": "id,accountEnabled,assignedLicenses", "$top": 999})
    total_users = len(users.get("value", []))
    licensed_users = sum(1 for u in users.get("value", []) if u.get("assignedLicenses"))
    enabled_users = sum(1 for u in users.get("value", []) if u.get("accountEnabled"))

    out = {
        "sku_summary": sku_summary,
        "total_users": total_users,
        "licensed_users": licensed_users,
        "enabled_users": enabled_users,
    }

    with open("ms365_raw_full.json", "w") as f:
        json.dump(out, f, indent=2)

    print("Saved ms365_raw_full.json")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()