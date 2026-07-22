"""
Microsoft 365 provider — pulls real licence + user data via Microsoft Graph
(app-only auth, client credentials flow). Requires an Azure AD App
Registration with Application permissions: Organization.Read.All,
User.Read.All, Directory.Read.All (admin consent granted).

Microsoft Graph doesn't expose actual $ billing — that lives in the
Microsoft 365 Admin Center / Partner Center billing API, which isn't
generally available without a CSP/partner relationship. So billing here
is computed from licence SKU counts × per-seat costs configured in .env.

SKU CLASSIFICATION:
XARKA only uses two licence tiers — Business Basic and Business Standard
(confirmed, no Premium in use). We classify by seat count: the SKU with
the most seats is Basic (the default/bulk plan), any other distinct SKU
present is Standard. If a third distinct SKU ever appears, it also gets
labelled Standard rather than invented as "Premium" — update TIER_ORDER
below if XARKA ever actually adds a Premium tier.
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


def _graph_get(
    token: str,
    path: str,
    params: dict | None = None,
    extra_headers: dict | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    if extra_headers:
        headers.update(extra_headers)
    resp = httpx.get(
        f"{GRAPH_BASE}{path}",
        headers=headers,
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


def _record_snapshot(total: int, standard: int, basic: int, bill: float) -> None:
    _ensure_snapshot_table()
    today = datetime.now(timezone.utc).date().isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO ms365_license_snapshot (date, total_licenses, premium_count, basic_count, monthly_bill) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET "
            "total_licenses=excluded.total_licenses, premium_count=excluded.premium_count, "
            "basic_count=excluded.basic_count, monthly_bill=excluded.monthly_bill",
            (today, total, standard, basic, bill),
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


def _license_trend(days: int = 90) -> list[dict[str, Any]]:
    _ensure_snapshot_table()
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT date, total_licenses, premium_count, basic_count, monthly_bill
            FROM ms365_license_snapshot
            WHERE date >= ?
            ORDER BY date ASC
            """,
            (cutoff,),
        ).fetchall()
    return [
        {
            "date": row[0],
            "total_licenses": row[1],
            "standard_count": row[2],
            "basic_count": row[3],
            "monthly_bill": row[4],
        }
        for row in rows
    ]


def _build_tier_map(skus: list[dict[str, Any]]) -> dict[str, tuple[str, str, float]]:
    """
    Explicit mapping by skuPartNumber — no more guessing by seat count.
    XARKA only has Basic + Standard as real paid tiers. Free/trial
    Microsoft add-ons are tracked separately and never billed.
    """
    KNOWN_SKUS = {
        "O365_BUSINESS_ESSENTIALS": ("basic", "Business Basic", ms365_config.basic_license_cost),
        "O365_BUSINESS_PREMIUM": ("standard", "Business Standard", ms365_config.standard_license_cost),
        "FLOW_FREE": ("free", "Power Automate (Free)", 0.0),
        "PROJECT_MADEIRA_PREVIEW_IW_SKU": ("free", "Business Central (Trial)", 0.0),
    }

    tier_map: dict[str, tuple[str, str, float]] = {}
    for sku in skus:
        if sku.get("consumedUnits", 0) <= 0:
            continue
        part = sku.get("skuPartNumber", "")
        sku_id = sku.get("skuId", "")
        if part in KNOWN_SKUS:
            tier_map[sku_id] = KNOWN_SKUS[part]
        else:
            logger.warning(
                "Unrecognized SKU %s (skuId=%s, %s consumed seats) — add it to KNOWN_SKUS in _build_tier_map.",
                part, sku_id, sku.get("consumedUnits"),
            )
            tier_map[sku_id] = ("unknown", part or "Unknown SKU", 0.0)

    return tier_map


def _get_job_titles(token: str, user_ids: list[str]) -> dict[str, str]:
    """
    Best-effort fetch of jobTitle for a batch of users. Returns {user_id: title}.
    If a user has no jobTitle set in Azure AD, they won't appear in the result
    (caller should default to something like "—").
    """
    titles: dict[str, str] = {}
    for uid in user_ids:
        try:
            resp = _graph_get(token, f"/users/{uid}", params={"$select": "id,jobTitle"})
            title = resp.get("jobTitle")
            if title:
                titles[uid] = title
        except httpx.HTTPStatusError:
            pass  # missing permission or field — leave unset, not fatal
    return titles


def ms365_insights(data: dict) -> list[dict]:
    insights = []
    change_pct = None
    bill_change = data.get("bill_change_vs_last_week", 0)
    last_week = None
    if bill_change != 0:
        prev_bill = data.get("monthly_bill", 0) - bill_change
        if prev_bill > 0:
            change_pct = round((bill_change / prev_bill) * 100, 1)
    if change_pct is not None and abs(change_pct) >= 15:
        direction = "increased" if change_pct > 0 else "decreased"
        insights.append({
            "provider": "ms365",
            "provider_label": "Microsoft 365",
            "today_value": data.get("monthly_bill"),
            "baseline_mean": None,
            "pct_vs_baseline": change_pct,
            "delta": bill_change,
            "severity": "warn" if abs(change_pct) < 30 else "danger",
            "explanation": (
                f"Microsoft 365 monthly bill {direction} by {abs(change_pct):.0f}% "
                f"(${abs(round(bill_change, 2)):,.2f}) compared to last week. "
                f"Current bill: ${data.get('monthly_bill', 0):,.2f}."
            ),
            "drivers": [],
        })
    inactive_waste = data.get("inactive_monthly_waste", 0)
    inactive_count = data.get("inactive_licensed_count", 0)
    if inactive_waste > 0 and inactive_count > 0:
        insights.append({
            "provider": "ms365",
            "provider_label": "Microsoft 365",
            "today_value": None,
            "baseline_mean": None,
            "pct_vs_baseline": None,
            "delta": inactive_waste,
            "severity": "warn",
            "explanation": (
                f"{inactive_count} licensed users haven't been active recently, "
                f"costing an estimated ${inactive_waste:,.2f}/month for unused "
                f"seats. Consider reassigning or removing these licenses."
            ),
            "drivers": [],
        })
    return insights


def fetch_ms365_data() -> dict[str, Any]:
    token = _get_token()

    skus_resp = _graph_get(token, "/subscribedSkus")
    skus = skus_resp.get("value", [])

    tier_map = _build_tier_map(skus)

    tier_counts: dict[str, int] = {}
    tier_costs: dict[str, float] = {}
    for sku in skus:
        sku_id = sku.get("skuId", "")
        assigned = sku.get("consumedUnits", 0)
        if sku_id in tier_map:
            tier, _, cost = tier_map[sku_id]
            tier_counts[tier] = tier_counts.get(tier, 0) + assigned
            tier_costs[tier] = cost
        elif assigned > 0:
            logger.warning(
                "SKU %s (skuId=%s) has %s consumed seats but wasn't classified — investigate.",
                sku.get("skuPartNumber"), sku_id, assigned,
            )

    # Only "basic" and "standard" are real paid seats.
    # "free" and "unknown" tiers are tracked but never billed.
    PAID_TIERS = {"basic", "standard"}

    standard_count = tier_counts.get("standard", 0)
    basic_count = tier_counts.get("basic", 0)
    free_count = sum(v for k, v in tier_counts.items() if k not in PAID_TIERS)

    total_licenses = sum(v for k, v in tier_counts.items() if k in PAID_TIERS)

    monthly_bill = round(
        sum(tier_counts[t] * tier_costs[t] for t in tier_counts if t in PAID_TIERS),
        2,
    )
    _record_snapshot(total_licenses, standard_count, basic_count, monthly_bill)

    # ALL users, not just recent 10 — sorted by creation date desc, with licence + job title
    try:
        users_resp = _graph_get(
            token,
            "/users",
            params={
                "$select": "displayName,mail,userPrincipalName,createdDateTime,id,jobTitle,signInActivity",
                "$orderby": "createdDateTime desc",
                "$top": "999",
                "$count": "true",
            },
            extra_headers={"ConsistencyLevel": "eventual"},
        )
        sign_in_available = True
    except httpx.HTTPStatusError:
        # NOTE: this is a PERMANENT, expected condition on this tenant — not an error.
        # AuditLog.Read.All is granted correctly; signInActivity requires Azure AD
        # Premium P1/P2 licensing on the tenant, which this tenant doesn't have
        # (Business Basic/Standard only). See backend/_debug_ms365.py for the
        # original diagnostic. Logged at debug level since this fires every refresh
        # cycle and isn't something to act on or alert on.
        logger.debug(
            "signInActivity unavailable — tenant lacks Azure AD Premium P1/P2 licensing; "
            "retrying users without it"
        )
        users_resp = _graph_get(
            token,
            "/users",
            params={
                "$select": "displayName,mail,userPrincipalName,createdDateTime,id,jobTitle",
                "$orderby": "createdDateTime desc",
                "$top": "999",
                "$count": "true",
            },
            extra_headers={"ConsistencyLevel": "eventual"},
        )
        sign_in_available = False

    recent_users = []
    inactive_licensed_users = []
    inactive_cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    for u in users_resp.get("value", []):
        created = u.get("createdDateTime", "")
        user_id = u.get("id")

        license_names = []
        license_cost = 0.0
        try:
            lic_resp = _graph_get(token, f"/users/{user_id}/licenseDetails")
            lic_values = lic_resp.get("value", [])
            for lv in lic_values:
                sku_id = lv.get("skuId", "")
                if sku_id in tier_map:
                    _, name, cost = tier_map[sku_id]
                    license_names.append(name)
                    license_cost += cost
                else:
                    license_names.append(lv.get("skuPartNumber", "Unknown"))
        except httpx.HTTPStatusError:
            logger.warning("Could not fetch licenseDetails for user %s", user_id)

        sign_in = u.get("signInActivity") or {}
        last_sign_in = sign_in.get("lastSuccessfulSignInDateTime") or sign_in.get("lastSignInDateTime")
        inactive_days = None
        is_inactive = False
        if sign_in_available and license_cost > 0:
            if last_sign_in:
                try:
                    last_dt = datetime.fromisoformat(last_sign_in.replace("Z", "+00:00"))
                    inactive_days = int((datetime.now(timezone.utc) - last_dt).total_seconds() / 86400)
                    is_inactive = last_dt < inactive_cutoff
                except (TypeError, ValueError):
                    is_inactive = True
            else:
                is_inactive = True

        if is_inactive:
            inactive_licensed_users.append(
                {
                    "name": u.get("displayName"),
                    "email": u.get("mail") or u.get("userPrincipalName"),
                    "license": ", ".join(license_names) if license_names else "Licensed",
                    "cost": round(license_cost, 2),
                    "last_sign_in": last_sign_in,
                    "inactive_days": inactive_days,
                }
            )

        recent_users.append(
            {
                "name": u.get("displayName"),
                "email": u.get("mail") or u.get("userPrincipalName"),
                "title": u.get("jobTitle") or "—",
                "created": created[:10] if created else None,
                "license": ", ".join(license_names) if license_names else "Unlicensed",
                "cost": round(license_cost, 2),
                "last_sign_in": last_sign_in,
                "inactive_days": inactive_days,
            }
        )

    # MFA status via credentialUserRegistrationDetails.
    # NOTE: this is a PERMANENT, expected condition on this tenant — not an error.
    # Reports.Read.All is granted correctly; this endpoint requires Azure AD Premium
    # P1/P2 licensing, which this tenant doesn't have. Logged at debug level since
    # this fires every refresh cycle and isn't something to act on or alert on.
    mfa_pending = 0
    try:
        mfa_resp = _graph_get(token, "/reports/credentialUserRegistrationDetails")
        mfa_pending = sum(1 for r in mfa_resp.get("value", []) if not r.get("isMfaRegistered"))
    except httpx.HTTPStatusError:
        logger.debug(
            "MFA registration report unavailable — requires Azure AD Premium P1/P2 "
            "licensing on the tenant"
        )

    last_week = _last_week_snapshot()
    new_ids_7d = (total_licenses - last_week["total_licenses"]) if last_week else 0
    bill_change_inr = (monthly_bill - last_week["monthly_bill"]) if last_week else 0.0
    inactive_licensed_users.sort(key=lambda u: u["cost"], reverse=True)
    inactive_monthly_waste_inr = round(sum(u["cost"] for u in inactive_licensed_users), 2)

    # MS365 billing is natively in INR (Microsoft bills in INR for Indian tenants).
    # The frontend's Microsoft365Page uses fmtINR() and explicitly opts out of the
    # global USD/INR toggle — so we return all monetary values in INR here.
    # Do NOT convert to USD; that was causing the displayed numbers to be ~84x too small.
    cost_per_user_inr = round(monthly_bill / total_licenses, 2) if total_licenses else 0.0
    inactive_monthly_waste_inr = round(sum(u["cost"] for u in inactive_licensed_users), 2)

    return {
        "provider": "ms365",
        "currency": "INR",
        "total_licenses": total_licenses,
        "monthly_bill": monthly_bill,                          # INR
        "cost_per_user": cost_per_user_inr,                    # INR
        "basic_count": basic_count,
        "standard_count": standard_count,
        "free_count": free_count,
        "basic_cost_per_user": ms365_config.basic_license_cost,      # INR
        "standard_cost_per_user": ms365_config.standard_license_cost, # INR
        "premium_cost_per_user": ms365_config.premium_license_cost,  # INR
        "new_ids_7d": new_ids_7d,
        "bill_change_vs_last_week": round(bill_change_inr, 2),       # INR
        "mfa_pending": mfa_pending,
        "inactive_licensed_count": len(inactive_licensed_users),
        "inactive_monthly_waste": inactive_monthly_waste_inr,         # INR
        "inactive_licensed_users": inactive_licensed_users[:12],
        "sign_in_activity_available": sign_in_available,
        "license_trend": _license_trend(),
        "recent_users": recent_users,
    }