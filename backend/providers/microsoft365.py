"""
Microsoft 365 provider — pulls real licence + user data via Microsoft Graph
(app-only auth, client credentials flow). Requires an Azure AD App
Registration with Application permissions: Organization.Read.All,
User.Read.All, Directory.Read.All (admin consent granted).

Microsoft Graph doesn't expose actual $ billing — that lives in the
Microsoft 365 Admin Center / Partner Center billing API, which isn't
generally available without a CSP/partner relationship. So billing here
is computed from licence SKU counts × per-seat costs configured in .env,
which is how most internal cost trackers approximate it.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import msal

from cache import get_conn
from config import ms365_config

logger = logging.getLogger("spendwatch.ms365")

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Common SKU part-number prefixes -> friendly tier name + assumed cost lookup
PREMIUM_SKUS = {"SPE_E5", "ENTERPRISEPREMIUM", "SPB"}  # Business Premium / E5 / Spt Biz
BASIC_SKUS = {"O365_BUSINESS_ESSENTIALS", "EXCHANGESTANDARD"}  # Business Basic, etc.


def _get_token() -> str:
    if not (ms365_config.tenant_id and ms365_config.client_id and ms365_config.client_secret):
        raise RuntimeError("MS365_TENANT_ID / MS365_CLIENT_ID / MS365_CLIENT_SECRET missing in .env")

    app = msal.ConfidentialClientApplication(
        ms365_config.client_id,
        authority=f"https://login.microsoftonline.com/{ms365_config.tenant_id}",
        client_credential=ms365_config.client_secret,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" not in result:
        raise RuntimeError(f"MS Graph auth failed: {result.get('error_description')}")
    return result["access_token"]


def _graph_get(token: str, path: str, params: dict | None = None) -> dict[str, Any]:
    resp = httpx.get(
        f"{GRAPH_BASE}{path}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or {},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def _ensure_snapshot_table() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ms365_license_snapshot (
                date TEXT PRIMARY KEY,
                total_licenses INTEGER,
                premium_count INTEGER,
                basic_count INTEGER,
                monthly_bill REAL
            )
            """
        )
        conn.commit()


def _record_snapshot(total: int, premium: int, basic: int, bill: float) -> None:
    _ensure_snapshot_table()
    today = datetime.now(timezone.utc).date().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO ms365_license_snapshot (date, total_licenses, premium_count, basic_count, monthly_bill) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET "
            "total_licenses=excluded.total_licenses, premium_count=excluded.premium_count, "
            "basic_count=excluded.basic_count, monthly_bill=excluded.monthly_bill",
            (today, total, premium, basic, bill),
        )
        conn.commit()


def _last_week_snapshot() -> dict[str, Any] | None:
    _ensure_snapshot_table()
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT total_licenses, monthly_bill FROM ms365_license_snapshot WHERE date <= ? ORDER BY date DESC LIMIT 1",
            (cutoff,),
        ).fetchone()
    if not row:
        return None
    return {"total_licenses": row[0], "monthly_bill": row[1]}


def fetch_ms365_data() -> dict[str, Any]:
    token = _get_token()

    skus_resp = _graph_get(token, "/subscribedSkus")
    skus = skus_resp.get("value", [])

    premium_count = 0
    basic_count = 0
    other_count = 0
    for sku in skus:
        part = sku.get("skuPartNumber", "")
        assigned = sku.get("consumedUnits", 0)
        if part in PREMIUM_SKUS:
            premium_count += assigned
        elif part in BASIC_SKUS:
            basic_count += assigned
        else:
            other_count += assigned

    total_licenses = premium_count + basic_count + other_count
    monthly_bill = round(
        premium_count * ms365_config.premium_license_cost + basic_count * ms365_config.basic_license_cost,
        2,
    )
    _record_snapshot(total_licenses, premium_count, basic_count, monthly_bill)

    # Recently created users, sorted by creation date desc
    users_resp = _graph_get(
        token,
        "/users",
        params={
            "$select": "displayName,mail,userPrincipalName,createdDateTime,id",
            "$orderby": "createdDateTime desc",
            "$top": "10",
        },
    )
    recent_users = []
    for u in users_resp.get("value", []):
        created = u.get("createdDateTime", "")
        recent_users.append(
            {
                "name": u.get("displayName"),
                "email": u.get("mail") or u.get("userPrincipalName"),
                "created": created[:10] if created else None,
                "license": "Business Premium" if premium_count else "Business Basic",
                "cost": ms365_config.premium_license_cost,
            }
        )

    # MFA status (requires Reports.Read.All — handle gracefully if missing)
    mfa_pending = 0
    try:
        mfa_resp = _graph_get(token, "/reports/credentialUserRegistrationDetails")
        mfa_pending = sum(1 for r in mfa_resp.get("value", []) if not r.get("isMfaRegistered"))
    except httpx.HTTPStatusError:
        logger.warning("MFA registration report unavailable (needs Reports.Read.All permission)")

    last_week = _last_week_snapshot()
    new_ids_7d = (total_licenses - last_week["total_licenses"]) if last_week else 0
    bill_change = (monthly_bill - last_week["monthly_bill"]) if last_week else 0.0

    return {
        "provider": "ms365",
        "total_licenses": total_licenses,
        "monthly_bill": monthly_bill,
        "cost_per_user": round(monthly_bill / total_licenses, 2) if total_licenses else 0.0,
        "premium_count": premium_count,
        "basic_count": basic_count,
        "new_ids_7d": new_ids_7d,
        "bill_change_vs_last_week": round(bill_change, 2),
        "mfa_pending": mfa_pending,
        "recent_users": recent_users,
    }
