"""Deep-extraction endpoints: waste scans, granular breakdowns, utilization."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import boto3
import httpx

from config import runpod_config
from providers.aws import _client as ce_client
from providers.aws_resources import _all_regions, _ec2_client
from providers.google_ads import _client as gads_client, _run_query
from providers.microsoft365 import _get_token, _graph_get
from providers import e2e_networks

logger = logging.getLogger("spendwatch.extras")

# ---------------------------------------------------------------- AWS

def fetch_aws_waste_scan() -> dict[str, Any]:
    """Unattached EBS volumes, unused EIPs, snapshots older than 90 days."""
    volumes, eips, snapshots = [], [], []
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    for region in _all_regions():
        try:
            ec2 = _ec2_client(region)
            for v in ec2.describe_volumes(
                Filters=[{"Name": "status", "Values": ["available"]}]
            )["Volumes"]:
                volumes.append({
                    "region": region, "id": v["VolumeId"], "size_gb": v["Size"],
                    "type": v["VolumeType"],
                    "est_monthly_cost_usd": round(v["Size"] * (0.08 if v["VolumeType"] == "gp3" else 0.10), 2),
                })
            for a in ec2.describe_addresses()["Addresses"]:
                if "AssociationId" not in a:
                    eips.append({"region": region, "ip": a.get("PublicIp"),
                                 "est_monthly_cost_usd": 3.6})
            for s in ec2.describe_snapshots(OwnerIds=["self"])["Snapshots"]:
                if s["StartTime"] < cutoff:
                    snapshots.append({
                        "region": region, "id": s["SnapshotId"],
                        "size_gb": s["VolumeSize"],
                        "age_days": (datetime.now(timezone.utc) - s["StartTime"]).days,
                        "est_monthly_cost_usd": round(s["VolumeSize"] * 0.05, 2),
                    })
        except Exception as exc:
            logger.warning("waste scan skipped region %s: %s", region, exc)
    total = sum(x["est_monthly_cost_usd"] for x in volumes + eips + snapshots)
    return {
        "unattached_volumes": volumes, "unused_eips": eips,
        "old_snapshots": sorted(snapshots, key=lambda s: -s["size_gb"])[:25],
        "est_total_monthly_waste_usd": round(total, 2),
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


def fetch_aws_cost_by_tag(tag_key: str = "Project", days: int = 30) -> dict[str, Any]:
    end = date.today() + timedelta(days=1)
    start = end - timedelta(days=days)
    resp = ce_client().get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY", Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "TAG", "Key": tag_key}],
    )
    rows: dict[str, float] = {}
    for period in resp["ResultsByTime"]:
        for g in period["Groups"]:
            name = g["Keys"][0].split("$", 1)[-1] or "(untagged)"
            rows[name] = rows.get(name, 0) + float(g["Metrics"]["UnblendedCost"]["Amount"])
    items = sorted(({"tag": k, "cost": round(v, 2)} for k, v in rows.items()),
                   key=lambda r: -r["cost"])
    return {"tag_key": tag_key, "items": items}


def fetch_aws_record_types(days: int = 30) -> dict[str, Any]:
    """Usage vs Tax vs Credit vs Refund — shows real burn vs offsets."""
    end = date.today() + timedelta(days=1)
    start = end - timedelta(days=days)
    resp = ce_client().get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": end.isoformat()},
        Granularity="MONTHLY", Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "RECORD_TYPE"}],
    )
    rows: dict[str, float] = {}
    for period in resp["ResultsByTime"]:
        for g in period["Groups"]:
            rows[g["Keys"][0]] = rows.get(g["Keys"][0], 0) + float(g["Metrics"]["UnblendedCost"]["Amount"])
    return {"breakdown": [{"type": k, "amount": round(v, 2)} for k, v in sorted(rows.items(), key=lambda r: -abs(r[1]))]}


def fetch_aws_sp_recommendation() -> dict[str, Any]:
    try:
        resp = ce_client().get_savings_plans_purchase_recommendation(
            SavingsPlansType="COMPUTE_SP", TermInYears="ONE_YEAR",
            PaymentOption="NO_UPFRONT", LookbackPeriodInDays="THIRTY_DAYS",
        )
        summary = resp.get("SavingsPlansPurchaseRecommendation", {}).get(
            "SavingsPlansPurchaseRecommendationSummary", {})
        return {
            "available": True,
            "est_monthly_savings_usd": float(summary.get("EstimatedMonthlySavingsAmount", 0) or 0),
            "est_savings_pct": float(summary.get("EstimatedSavingsPercentage", 0) or 0),
            "recommended_hourly_commitment_usd": float(summary.get("HourlyCommitmentToPurchase", 0) or 0),
        }
    except Exception as exc:
        return {"available": False, "reason": str(exc)}

# ------------------------------------------------------------- RunPod

def fetch_runpod_utilization() -> dict[str, Any]:
    """Live GPU/memory utilization per pod via GraphQL telemetry."""
    query = """
    query {
      myself { pods {
        id name desiredStatus costPerHr
        runtime { uptimeInSeconds
          gpus { id gpuUtilPercent memoryUtilPercent }
          container { cpuPercent memoryPercent } }
        machine { gpuDisplayName }
      } } }
    """
    r = httpx.post("https://api.runpod.io/graphql",
                   params={"api_key": runpod_config.api_key},
                   json={"query": query}, timeout=30)
    r.raise_for_status()
    pods_out = []
    for p in (r.json().get("data", {}).get("myself", {}) or {}).get("pods", []) or []:
        rt = p.get("runtime") or {}
        gpus = rt.get("gpus") or []
        pods_out.append({
            "id": p["id"], "name": p.get("name"),
            "status": p.get("desiredStatus"),
            "gpu": (p.get("machine") or {}).get("gpuDisplayName"),
            "cost_per_hr": p.get("costPerHr"),
            "uptime_hours": round((rt.get("uptimeInSeconds") or 0) / 3600, 1),
            "gpu_util_pct": round(sum(g.get("gpuUtilPercent") or 0 for g in gpus) / len(gpus), 1) if gpus else None,
            "gpu_mem_pct": round(sum(g.get("memoryUtilPercent") or 0 for g in gpus) / len(gpus), 1) if gpus else None,
            "cpu_pct": (rt.get("container") or {}).get("cpuPercent"),
        })
    underused = [p for p in pods_out
                 if p["status"] == "RUNNING" and (p["gpu_util_pct"] or 0) < 15 and p["uptime_hours"] > 2]
    return {"pods": pods_out, "underutilized": underused,
            "as_of": datetime.now(timezone.utc).isoformat()}


def fetch_runpod_cost_components(days: int = 30) -> dict[str, Any]:
    """Split spend into pods vs serverless vs storage vs network."""
    from providers.runpod import _fetch_billing
    out = {}
    for kind in ("pods", "endpoints", "storage", "network"):
        try:
            rows = _fetch_billing(days, kind=kind, grouping="gpuTypeId")
            out[kind] = round(sum(float(r.get("amount") or 0) for r in rows), 2)
        except Exception:
            out[kind] = None
    return {"components": out}

# --------------------------------------------------------- Google Ads

def _gads(query: str) -> list[Any]:
    client = gads_client()
    return _run_query(client, query)

def fetch_gads_search_terms(days: int = 30, limit: int = 40) -> dict[str, Any]:
    rows = _gads(f"""
        SELECT search_term_view.search_term, campaign.name,
               metrics.clicks, metrics.impressions, metrics.cost_micros,
               metrics.conversions
        FROM search_term_view
        WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC LIMIT {limit}""")
    return {"terms": [{
        "term": r.search_term_view.search_term, "campaign": r.campaign.name,
        "clicks": r.metrics.clicks, "impressions": r.metrics.impressions,
        "cost": round(r.metrics.cost_micros / 1e6, 2),
        "conversions": r.metrics.conversions,
    } for r in rows]}


def fetch_gads_device_breakdown() -> dict[str, Any]:
    rows = _gads("""
        SELECT segments.device, metrics.cost_micros, metrics.clicks,
               metrics.conversions
        FROM campaign WHERE segments.date DURING LAST_30_DAYS""")
    agg: dict[str, dict] = {}
    for r in rows:
        d = r.segments.device.name
        a = agg.setdefault(d, {"cost": 0.0, "clicks": 0, "conversions": 0.0})
        a["cost"] += r.metrics.cost_micros / 1e6
        a["clicks"] += r.metrics.clicks
        a["conversions"] += r.metrics.conversions
    return {"devices": [{"device": k, **{kk: round(vv, 2) for kk, vv in v.items()}}
                        for k, v in sorted(agg.items(), key=lambda x: -x[1]["cost"])]}


def fetch_gads_geo_breakdown(limit: int = 15) -> dict[str, Any]:
    rows = _gads(f"""
        SELECT geographic_view.country_criterion_id, metrics.cost_micros,
               metrics.clicks, metrics.conversions
        FROM geographic_view WHERE segments.date DURING LAST_30_DAYS
        ORDER BY metrics.cost_micros DESC LIMIT {limit}""")
    return {"regions": [{
        "geo_id": r.geographic_view.country_criterion_id,
        "cost": round(r.metrics.cost_micros / 1e6, 2),
        "clicks": r.metrics.clicks, "conversions": r.metrics.conversions,
    } for r in rows]}


def fetch_gads_hourly() -> dict[str, Any]:
    rows = _gads("""
        SELECT segments.hour, metrics.cost_micros, metrics.clicks,
               metrics.conversions
        FROM campaign WHERE segments.date DURING LAST_30_DAYS""")
    hours = {h: {"cost": 0.0, "clicks": 0, "conversions": 0.0} for h in range(24)}
    for r in rows:
        h = hours[r.segments.hour]
        h["cost"] += r.metrics.cost_micros / 1e6
        h["clicks"] += r.metrics.clicks
        h["conversions"] += r.metrics.conversions
    return {"hours": [{"hour": k, **{kk: round(vv, 2) for kk, vv in v.items()}}
                      for k, v in hours.items()]}


def fetch_gads_budget_pacing() -> dict[str, Any]:
    rows = _gads("""
        SELECT campaign.name, campaign_budget.amount_micros,
               metrics.cost_micros
        FROM campaign
        WHERE segments.date DURING THIS_MONTH AND campaign.status = 'ENABLED'""")
    agg: dict[str, dict] = {}
    for r in rows:
        a = agg.setdefault(r.campaign.name, {
            "daily_budget": r.campaign_budget.amount_micros / 1e6, "mtd_cost": 0.0})
        a["mtd_cost"] += r.metrics.cost_micros / 1e6
    day = date.today().day
    out = []
    for name, v in agg.items():
        expected = v["daily_budget"] * day
        out.append({
            "campaign": name, "daily_budget": round(v["daily_budget"], 2),
            "mtd_cost": round(v["mtd_cost"], 2),
            "expected_mtd": round(expected, 2),
            "pacing_pct": round(v["mtd_cost"] / expected * 100, 1) if expected else None,
        })
    return {"campaigns": sorted(out, key=lambda c: -(c["mtd_cost"]))}

# ------------------------------------------------------ Microsoft 365

def _graph_get_csv(token: str, path: str) -> str:
    resp = httpx.get(
        f"https://graph.microsoft.com/v1.0{path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30, follow_redirects=True,
    )
    resp.raise_for_status()
    return resp.text

def fetch_ms365_storage_usage() -> dict[str, Any]:
    token = _get_token()
    out = {"mailbox": [], "onedrive": [], "available": True}
    try:
        mb = _graph_get_csv(token, "/reports/getMailboxUsageDetail(period='D30')")
        od = _graph_get_csv(token, "/reports/getOneDriveUsageAccountDetail(period='D30')")
        import csv, io
        for key, blob in (("mailbox", mb), ("onedrive", od)):
            for row in csv.DictReader(io.StringIO(blob)):
                out[key].append({
                    "user": row.get("User Principal Name") or row.get("Owner Principal Name"),
                    "used_gb": round(float(row.get("Storage Used (Byte)") or 0) / 1e9, 2),
                    "quota_gb": round(float(row.get("Prohibit Send/Receive Quota (Byte)")
                                            or row.get("Storage Allocated (Byte)") or 0) / 1e9, 1),
                })
            out[key].sort(key=lambda r: -r["used_gb"])
    except Exception as exc:
        out = {"available": False, "reason": f"Needs Reports.Read.All: {exc}"}
    return out


def fetch_ms365_app_activity() -> dict[str, Any]:
    token = _get_token()
    try:
        blob = _graph_get_csv(token, "/reports/getOffice365ActiveUserDetail(period='D30')")
        import csv, io
        users = []
        for row in csv.DictReader(io.StringIO(blob)):
            users.append({
                "user": row.get("User Principal Name"),
                "exchange_last": row.get("Exchange Last Activity Date") or None,
                "teams_last": row.get("Teams Last Activity Date") or None,
                "onedrive_last": row.get("OneDrive Last Activity Date") or None,
                "sharepoint_last": row.get("SharePoint Last Activity Date") or None,
            })
        idle = [u for u in users if not (u["exchange_last"] or u["teams_last"])]
        return {"available": True, "users": users, "fully_idle": idle}
    except Exception as exc:
        return {"available": False, "reason": f"Needs Reports.Read.All: {exc}"}

# --------------------------------------------------------------- E2E

def fetch_e2e_committed_and_images() -> dict[str, Any]:
    out = {}
    for key, path in (("committed_nodes", "/nodes/committed/"),
                      ("images", "/images/saved/"),
                      ("volumes", "/block_storage/")):
        try:
            out[key] = e2e_networks._rest_get(path)
        except Exception as exc:
            out[key] = {"error": str(exc)}
    return out