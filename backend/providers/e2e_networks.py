"""
E2E Networks provider — pulls billing + live node status via E2E Networks' REST API.
Natively bills in INR.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from anomaly import AnomalySettings, compute_drivers, detect_anomaly, detect_anomaly_sma
from config import app_config, e2e_config
from fx import get_usd_exchange_rate, to_inr

logger = logging.getLogger("spendwatch.e2e_networks")

REST_BASE = "https://api.e2enetworks.com/myaccount/api/v1"

E2E_BILLING_VERIFY_ERROR = "Unable to verify billing data — check E2E Networks API key configuration."
E2E_BILLING_PENDING = (
    "A node is currently running, but today's usage hasn't been reflected in billing data yet."
)


def _check_token_expiry(auth_token: str) -> str | None:
    """E2E auth tokens are JWTs and expire. Return a human reason if expired/undecodable."""
    try:
        import base64
        import json as _json

        parts = auth_token.split(".")
        if len(parts) != 3:
            return None  # not a JWT — can't check
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = _json.loads(base64.urlsafe_b64decode(payload_b64))
        exp = payload.get("exp")
        if exp and time.time() > float(exp):
            expired_at = datetime.fromtimestamp(float(exp), tz=timezone.utc)
            return (
                f"E2E auth token expired at {expired_at.isoformat()} — "
                "regenerate the token in MyAccount -> Products -> API and update E2E_AUTH_TOKEN."
            )
    except Exception:
        return None
    return None


def _rest_get(path: str, params: dict | None = None) -> Any:
    api_key = e2e_config.api_key
    auth_token = e2e_config.auth_token

    if not api_key or "fake" in api_key.lower():
        raise RuntimeError(E2E_BILLING_VERIFY_ERROR + " (E2E_API_KEY missing)")
    if not auth_token or "fake" in auth_token.lower():
        # The API key alone is NOT a valid Bearer credential — E2E requires the
        # separate auth token (JWT) downloaded alongside the API key.
        raise RuntimeError(
            E2E_BILLING_VERIFY_ERROR
            + " (E2E_AUTH_TOKEN missing — the Bearer auth token is required in "
            "addition to the API key; download both from MyAccount -> API)"
        )

    expiry_reason = _check_token_expiry(auth_token)
    if expiry_reason:
        raise RuntimeError(expiry_reason)

    headers = {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json",
    }

    # E2E requires project_id and location query parameters for scoping
    query_params = params or {}
    query_params["apikey"] = api_key
    if e2e_config.project_id:
        query_params["project_id"] = e2e_config.project_id
    if e2e_config.location:
        # E2E location values are capitalized in MyAccount ("Delhi", "Mumbai")
        query_params["location"] = str(e2e_config.location).strip().capitalize()

    try:
        resp = httpx.get(
            f"{REST_BASE}{path}",
            headers=headers,
            params=query_params,
            timeout=30,
        )
        if resp.status_code in (401, 403):
            # Surface E2E's own error message — e.g. "Customer Email not verified!" or "Access Denied Read.."
            err_msg = ""
            try:
                data = resp.json()
                if isinstance(data, dict):
                    err_msg = data.get("errors") or data.get("message") or ""
            except Exception:
                err_msg = (resp.text or "")[:200]

            logger.warning(
                "E2E %s returned %s for %s (project_id=%s location=%s): %s",
                path, resp.status_code, "GET", e2e_config.project_id,
                query_params.get("location"), err_msg,
            )
            raise RuntimeError(
                f"E2E Networks API error: {err_msg}" if err_msg else E2E_BILLING_VERIFY_ERROR
            )
        resp.raise_for_status()
        return resp.json()
    except RuntimeError:
        raise
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"E2E Networks API error {exc.response.status_code} on {path}"
        ) from exc
    except Exception as exc:
        raise RuntimeError(f"Connection to E2E Networks failed: {exc}") from exc


def _parse_date_from_description(desc: str) -> str | None:
    """Extract ISO date string from E2E billing item description."""
    if not desc:
        return None
    match = re.search(r'(\d{1,2})[-/]([A-Za-z]+|\d{1,2})[-/](\d{4})', desc)
    if match:
        day, month_str, year = match.groups()
        try:
            if month_str.isdigit():
                dt = datetime(int(year), int(month_str), int(day))
            else:
                # capitalize month name for strptime e.g. "April"
                m_cap = month_str.capitalize()
                fmt = "%d-%B-%Y" if len(m_cap) > 3 else "%d-%b-%Y"
                dt = datetime.strptime(f"{day}-{m_cap}-{year}", fmt)
            return dt.date().isoformat()
        except ValueError:
            pass
    return None


def _parse_hours_from_description(desc: str) -> float:
    """Extract node run duration in hours from E2E billing item description."""
    if not desc:
        return 0.0
    matches = re.findall(r'(\d{1,2})[-/]([A-Za-z]+|\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})', desc)
    if len(matches) >= 2:
        try:
            times = []
            for day, month_str, year, hour, minute in matches[:2]:
                m_cap = month_str.capitalize()
                if m_cap.isdigit():
                    dt = datetime(int(year), int(m_cap), int(day), int(hour), int(minute))
                else:
                    fmt = "%d-%B-%Y %H:%M" if len(m_cap) > 3 else "%d-%b-%Y %H:%M"
                    dt = datetime.strptime(f"{day}-{m_cap}-{year} {hour}:{minute}", fmt)
                times.append(dt)
            duration = times[1] - times[0]
            return max(0.0, duration.total_seconds() / 3600.0)
        except Exception:
            pass
    return 0.0


def _fetch_active_nodes() -> list[dict[str, Any]]:
    """Fetch live nodes currently running."""
    result = _rest_get("/nodes/")
    if isinstance(result, dict) and "data" in result:
        nodes = result["data"]
        if isinstance(nodes, list):
            return nodes
    return []


def _fetch_billing(days: int) -> list[dict[str, Any]]:
    """Fetch monthly prepaid estimate and parse usage items."""
    now = datetime.now(timezone.utc)
    # Estimate endpoint accepts month/year. We query the current month.
    result = _rest_get(
        "/billing/prepaid/monthly-estimate/",
        params={"month": now.month, "year": now.year},
    )
    if isinstance(result, dict) and "data" in result and "usage" in result["data"]:
        usage = result["data"]["usage"]
        if isinstance(usage, list):
            return usage
    return []


def fetch_e2e_monthly_spend(year: int, month: int) -> dict[str, Any]:
    """Fetch historical monthly spend totals."""
    try:
        result = _rest_get(
            "/billing/prepaid/monthly-estimate/",
            params={"month": month, "year": year},
        )
        total = 0.0
        if isinstance(result, dict) and "data" in result:
            total = result["data"].get("total_amount") or 0.0
        return {
            "provider": "e2e",
            "year": year,
            "month": month,
            "total": round(total, 2),
            "currency": "INR",
        }
    except Exception as exc:
        logger.warning("Failed to fetch historical spend for E2E: %s", exc)
        return {
            "provider": "e2e",
            "year": year,
            "month": month,
            "total": 0.0,
            "currency": "INR",
            "_error": str(exc),
        }


def fetch_e2e_data(days: int = 30) -> dict[str, Any]:
    """Fetch and construct complete E2E Networks data payload, mirroring RunPod payload structure."""
    active_nodes = _fetch_active_nodes()
    billing_items = _fetch_billing(days=days)

    empty_data_reason = None
    running_count = sum(1 for n in active_nodes if n.get("status") == "Running")
    
    if not billing_items and running_count > 0:
        empty_data_reason = E2E_BILLING_PENDING

    daily_totals: dict[str, float] = {}
    daily_gpu_hours: dict[str, float] = {}
    daily_cpu_hours: dict[str, float] = {}
    node_type_costs: dict[str, float] = {}
    node_type_daily: dict[str, dict[str, float]] = {}  # {node_type: {date: amount}}

    # E2E bills natively in INR. Keep all values natively in INR.
    for item in billing_items:
        desc = item.get("description") or ""
        sku = item.get("sku_name") or "General_Charges"
        amount = float(item.get("line_item_value") or 0.0)
        
        parsed_date = _parse_date_from_description(desc)
        if not parsed_date:
            parsed_date = datetime.now(timezone.utc).date().isoformat()
            
        hours = _parse_hours_from_description(desc)
        is_gpu = "gpu" in sku.lower() or "gpu" in desc.lower()

        # Update totals
        daily_totals[parsed_date] = daily_totals.get(parsed_date, 0.0) + amount
        
        if is_gpu:
            daily_gpu_hours[parsed_date] = daily_gpu_hours.get(parsed_date, 0.0) + hours
        else:
            daily_cpu_hours[parsed_date] = daily_cpu_hours.get(parsed_date, 0.0) + hours
            
        node_type_costs[sku] = node_type_costs.get(sku, 0.0) + amount
        node_type_daily.setdefault(sku, {})
        node_type_daily[sku][parsed_date] = node_type_daily[sku].get(parsed_date, 0.0) + amount

    # Fill daily series up through today
    today_utc = datetime.now(timezone.utc).date()
    if daily_totals:
        earliest = min(daily_totals.keys())
        start_date = datetime.strptime(earliest, "%Y-%m-%d").date()
        end_date = today_utc
        all_days = []
        d = start_date
        while d <= end_date:
            all_days.append(d.isoformat())
            d += timedelta(days=1)
    else:
        all_days = [today_utc.isoformat()]

    daily_series = [
        {"date": d, "value": round(daily_totals.get(d, 0.0), 2)}
        for d in all_days
    ]

    today_str = today_utc.isoformat()
    yesterday_str = (today_utc - timedelta(days=1)).isoformat()
    today_cost = round(daily_totals.get(today_str, 0.0), 2)
    yesterday_cost = round(daily_totals.get(yesterday_str, 0.0), 2)
    today_gpu_hours = round(daily_gpu_hours.get(today_str, 0.0), 2)
    today_cpu_hours = round(daily_cpu_hours.get(today_str, 0.0), 2)

    month_str = today_utc.strftime("%Y-%m")
    mtd_total = round(sum(v for d, v in daily_totals.items() if d.startswith(month_str)), 2)

    # Compute average
    days_with_prior_spend = [v for d, v in daily_totals.items() if d != today_str and v > 0]
    avg_per_day = round(sum(days_with_prior_spend) / len(days_with_prior_spend), 4) if days_with_prior_spend else 0.0

    # Build node breakdown
    total_node_cost = sum(node_type_costs.values()) or 1.0
    node_breakdown = [
        {"name": sku, "amount": round(amt, 2), "pct": round(amt / total_node_cost * 100, 1)}
        for sku, amt in sorted(node_type_costs.items(), key=lambda kv: kv[1], reverse=True)
    ]

    # Calculate free tier GPU hours (2 free GPU hours per month)
    total_gpu_hours_this_month = sum(daily_gpu_hours.values())
    free_tier_hours_used = min(total_gpu_hours_this_month, 2.0)
    free_tier_hours_remaining = max(0.0, 2.0 - total_gpu_hours_this_month)

    # Build node list for details
    nodes_out = []
    for n in active_nodes:
        plan = n.get("plan") or "General compute"
        status = n.get("status") or "Stopped"
        name = n.get("name") or "Unnamed Node"
        gpu_model = n.get("gpu") or ""
        
        # Parse price e.g., "Rs. 3.1/Hour"
        price_str = n.get("price") or ""
        cost_per_hr = 0.0
        match = re.search(r'Rs\.\s*([\d\.]+)/Hour', price_str)
        if match:
            try:
                cost_per_hr = float(match.group(1))
            except ValueError:
                pass

        created_at = n.get("created_at") or n.get("createdAt")
        uptime_sec = 0
        if created_at:
            try:
                clean_dt = created_at.replace("Z", "+00:00").split(".")[0]
                if " " in clean_dt and "+" not in clean_dt:
                    created_dt = datetime.fromisoformat(clean_dt).replace(tzinfo=timezone.utc)
                else:
                    created_dt = datetime.fromisoformat(clean_dt)
                uptime_sec = int((datetime.now(timezone.utc) - created_dt).total_seconds())
            except Exception:
                pass

        nodes_out.append({
            "id": n.get("id"),
            "name": name,
            "status": status,
            "cost_per_hr": cost_per_hr,
            "gpu": gpu_model or "CPU Only",
            "plan": plan,
            "public_ip_address": n.get("public_ip_address"),
            "private_ip_address": n.get("private_ip_address"),
            "uptime_seconds": uptime_sec,
        })

    # Anomaly checks
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=to_inr(app_config.min_dollar_delta),
        baseline_window_days=app_config.baseline_window_days,
    )
    anomaly = detect_anomaly([d["value"] for d in daily_series], settings)
    anomaly_sma = detect_anomaly_sma([d["value"] for d in daily_series])

    if anomaly.is_anomaly or anomaly_sma.is_anomaly:
        anomaly_drivers = compute_drivers(node_type_daily, all_days, settings)
    else:
        anomaly_drivers = []

    # Detect all historical spikes in the loaded range
    historical_spikes = []
    for i in range(7, len(daily_series)):
        date_str = daily_series[i]["date"]
        val = daily_series[i]["value"]
        if val <= 0:
            continue
        prev_vals = [daily_series[j]["value"] for j in range(max(0, i - 7), i)]
        mean = sum(prev_vals) / len(prev_vals) if prev_vals else 0.0
        if mean > 0 and val > mean * 1.3 and (val - mean) > 50.0:
            sku_deltas = []
            for sku, daily_map in node_type_daily.items():
                sku_val = daily_map.get(date_str, 0.0)
                sku_prev = [daily_map.get(all_days[j], 0.0) for j in range(max(0, i - 7), i)]
                sku_mean = sum(sku_prev) / len(sku_prev) if sku_prev else 0.0
                sku_delta = sku_val - sku_mean
                if sku_val > 0:
                    sku_deltas.append({
                        "name": sku,
                        "value": sku_val,
                        "delta": sku_delta
                    })
            sku_deltas.sort(key=lambda x: x["delta"], reverse=True)
            top_sku = sku_deltas[0]["name"] if sku_deltas else "General Charges"
            top_delta = sku_deltas[0]["delta"] if sku_deltas else 0.0
            historical_spikes.append({
                "date": date_str,
                "value": round(val, 2),
                "baseline_mean": round(mean, 2),
                "pct_increase": round(((val - mean) / mean * 100), 1),
                "top_driver": top_sku,
                "driver_increase": round(top_delta, 2)
            })
    historical_spikes.sort(key=lambda x: x["date"], reverse=True)

    # Calculate last month same period
    import calendar
    if today_utc.month == 1:
        last_year = today_utc.year - 1
        last_month = 12
    else:
        last_year = today_utc.year
        last_month = today_utc.month - 1
        
    _, last_month_days = calendar.monthrange(last_year, last_month)
    last_day = min(today_utc.day, last_month_days)
    
    last_month_start = date(last_year, last_month, 1)
    last_month_end = date(last_year, last_month, last_day)

    try:
        last_month_result = _rest_get(
            "/billing/prepaid/monthly-estimate/",
            params={"month": last_month, "year": last_year},
        )
        last_usage = []
        if isinstance(last_month_result, dict) and "data" in last_month_result and "usage" in last_month_result["data"]:
            last_usage = last_month_result["data"]["usage"]
        
        last_month_same_period = 0.0
        for item in last_usage:
            desc = item.get("description") or ""
            amount = float(item.get("line_item_value") or 0.0)
            parsed_date = _parse_date_from_description(desc)
            if parsed_date and parsed_date <= last_month_end.isoformat():
                last_month_same_period += amount
    except Exception as exc:
        logger.warning("Failed to fetch prior month same period cost for E2E: %s", exc)
        last_month_same_period = 0.0

    vs_last_month_pct = None
    if last_month_same_period and last_month_same_period > 0:
        vs_last_month_pct = round(((mtd_total - last_month_same_period) / last_month_same_period) * 100, 1)

    # Projected month end
    days_in_month = calendar.monthrange(today_utc.year, today_utc.month)[1]
    days_elapsed = today_utc.day
    projected_month_end = round((mtd_total / days_elapsed) * days_in_month, 2) if days_elapsed > 0 else 0.0

    # Possible idle nodes (running nodes with uptime > 7 days)
    possible_idle_nodes = [
        {
            "id": node["id"],
            "name": node["name"],
            "uptime_seconds": node["uptime_seconds"],
            "cost_per_hr": node["cost_per_hr"],
            "gpu": node["gpu"]
        }
        for node in nodes_out
        if node["status"] == "Running" and node["uptime_seconds"] > 7 * 86400
    ]

    return {
        "provider": "e2e",
        "currency": "INR",
        "today": today_cost,
        "yesterday": yesterday_cost,
        "avg_per_day": avg_per_day,
        "active_nodes_count": running_count,
        "gpu_hours_today": today_gpu_hours,
        "cpu_hours_today": today_cpu_hours,
        "month_to_date": mtd_total,
        "vs_last_month_pct": vs_last_month_pct,
        "projected_month_end": projected_month_end,
        "possible_idle_nodes": possible_idle_nodes,
        "daily_series": daily_series,
        "nodes": nodes_out,
        "node_breakdown": node_breakdown,
        "anomaly": anomaly.__dict__,
        "anomaly_sma": anomaly_sma.__dict__,
        "anomaly_drivers": anomaly_drivers,
        "historical_spikes": historical_spikes,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "empty_data_reason": empty_data_reason,
        "free_tier_hours_used": round(free_tier_hours_used, 2),
        "free_tier_hours_remaining": round(free_tier_hours_remaining, 2),
    }