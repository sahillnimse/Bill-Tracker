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

logger = logging.getLogger("spendwatch.e2e_networks")

REST_BASE = "https://api.e2enetworks.com/myaccount/api/v1"

E2E_BILLING_VERIFY_ERROR = "Unable to verify billing data — check E2E Networks API key configuration."
E2E_BILLING_PENDING = (
    "A node is currently running, but today's usage hasn't been reflected in billing data yet."
)


def _rest_get(path: str, params: dict | None = None) -> Any:
    if not e2e_config.api_key or "fake" in e2e_config.api_key.lower():
        raise RuntimeError(E2E_BILLING_VERIFY_ERROR)

    headers = {
        "Authorization": f"Bearer {e2e_config.api_key}",
        "Content-Type": "application/json",
    }
    
    # E2E requires project_id and location query parameters for scoping
    query_params = params or {}
    query_params["apikey"] = e2e_config.api_key
    if e2e_config.project_id:
        query_params["project_id"] = e2e_config.project_id
    if e2e_config.location:
        query_params["location"] = e2e_config.location

    try:
        resp = httpx.get(
            f"{REST_BASE}{path}",
            headers=headers,
            params=query_params,
            timeout=30,
        )
        if resp.status_code in (401, 403):
            raise RuntimeError(E2E_BILLING_VERIFY_ERROR)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (401, 403):
            raise RuntimeError(E2E_BILLING_VERIFY_ERROR) from exc
        raise
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
        logger.exception("Failed to fetch historical spend for E2E")
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

    # Parse and aggregate billing line items
    for item in billing_items:
        desc = item.get("description") or ""
        sku = item.get("sku_name") or "General_Charges"
        amount = item.get("line_item_value") or 0.0
        
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

        nodes_out.append({
            "id": n.get("id"),
            "name": name,
            "status": status,
            "cost_per_hr": cost_per_hr,
            "gpu": gpu_model or "CPU Only",
            "plan": plan,
            "public_ip_address": n.get("public_ip_address"),
            "private_ip_address": n.get("private_ip_address"),
        })

    # Anomaly checks
    settings = AnomalySettings(
        z_threshold=app_config.z_score_threshold,
        min_dollar_delta=app_config.min_dollar_delta,
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

    return {
        "provider": "e2e",
        "today": today_cost,
        "yesterday": yesterday_cost,
        "avg_per_day": avg_per_day,
        "active_nodes_count": running_count,
        "gpu_hours_today": today_gpu_hours,
        "cpu_hours_today": today_cpu_hours,
        "month_to_date": mtd_total,
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
