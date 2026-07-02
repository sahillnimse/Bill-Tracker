"""
AWS resource-level detail — EC2 instance tracking and deep Cost Explorer
service/usage breakdown, layered on top of the existing aws.py cost summary.

Requires additional IAM permissions beyond what aws.py needs:
  - ec2:DescribeInstances
  - ec2:DescribeRegions
  - cloudwatch:GetMetricData (for CPU utilization per instance)

These are all read-only. Attach the AWS managed policy
"AmazonEC2ReadOnlyAccess" (or an equivalent custom policy) to the IAM user
already used for Cost Explorer.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import boto3

from config import aws_config

logger = logging.getLogger("spendwatch.aws_resources")


def _ec2_client(region: str):
    return boto3.client(
        "ec2",
        region_name=region,
        aws_access_key_id=aws_config.access_key_id,
        aws_secret_access_key=aws_config.secret_access_key,
    )


def _cloudwatch_client(region: str):
    return boto3.client(
        "cloudwatch",
        region_name=region,
        aws_access_key_id=aws_config.access_key_id,
        aws_secret_access_key=aws_config.secret_access_key,
    )


def _ce_client():
    return boto3.client(
        "ce",
        region_name="us-east-1",  # Cost Explorer is a global endpoint
        aws_access_key_id=aws_config.access_key_id,
        aws_secret_access_key=aws_config.secret_access_key,
    )


def _all_regions() -> list[str]:
    """EC2 is region-scoped, unlike Cost Explorer, so we have to enumerate
    every enabled region and check each one for running/stopped instances."""
    ec2 = _ec2_client(aws_config.region or "us-east-1")
    resp = ec2.describe_regions(AllRegions=False)  # only regions enabled for this account
    return [r["RegionName"] for r in resp["Regions"]]


def _instance_name(instance: dict) -> str:
    for tag in instance.get("Tags", []) or []:
        if tag.get("Key") == "Name":
            return tag["Value"]
    return instance["InstanceId"]


def _avg_cpu_utilization(region: str, instance_id: str, hours: int = 24) -> float | None:
    """Average CPU% over the trailing `hours`, using CloudWatch's free
    5-minute-granularity EC2 metrics (no extra cost, no detailed monitoring
    required)."""
    cw = _cloudwatch_client(region)
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)

    resp = cw.get_metric_statistics(
        Namespace="AWS/EC2",
        MetricName="CPUUtilization",
        Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
        StartTime=start,
        EndTime=end,
        Period=3600,
        Statistics=["Average"],
    )
    points = resp.get("Datapoints", [])
    if not points:
        return None
    return round(sum(p["Average"] for p in points) / len(points), 1)


def fetch_ec2_instances() -> dict[str, Any]:
    """
    Scans every enabled region for EC2 instances and returns their live
    state, type, launch time, uptime, and trailing-24h average CPU
    utilization. This is real, queried-at-request-time data — not derived
    or estimated.
    """
    if not aws_config.access_key_id or not aws_config.secret_access_key:
        raise RuntimeError(
            "AWS credentials missing. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env"
        )

    try:
        regions = _all_regions()
    except Exception as exc:
        raise RuntimeError(
            f"Could not list AWS regions — check that the IAM user has "
            f"ec2:DescribeRegions permission. Original error: {exc}"
        ) from exc

    instances: list[dict[str, Any]] = []
    type_counts: dict[str, int] = {}
    region_counts: dict[str, int] = {}
    running_count = 0
    stopped_count = 0

    for region in regions:
        try:
            ec2 = _ec2_client(region)
            resp = ec2.describe_instances()
        except Exception as exc:
            logger.warning("Skipping region %s: %s", region, exc)
            continue

        for reservation in resp.get("Reservations", []):
            for inst in reservation.get("Instances", []):
                state = inst["State"]["Name"]
                if state == "terminated":
                    continue

                instance_type = inst.get("InstanceType", "unknown")
                launch_time = inst.get("LaunchTime")
                uptime_hours = None
                if launch_time and state == "running":
                    uptime_hours = round(
                        (datetime.now(timezone.utc) - launch_time).total_seconds() / 3600, 1
                    )

                cpu_avg = None
                if state == "running":
                    try:
                        cpu_avg = _avg_cpu_utilization(region, inst["InstanceId"])
                    except Exception as exc:
                        logger.warning("CloudWatch lookup failed for %s: %s", inst["InstanceId"], exc)

                instances.append(
                    {
                        "id": inst["InstanceId"],
                        "name": _instance_name(inst),
                        "type": instance_type,
                        "state": state,
                        "region": region,
                        "az": inst.get("Placement", {}).get("AvailabilityZone"),
                        "launch_time": launch_time.isoformat() if launch_time else None,
                        "uptime_hours": uptime_hours,
                        "avg_cpu_pct_24h": cpu_avg,
                        "platform": inst.get("PlatformDetails", "Linux/UNIX"),
                        "private_ip": inst.get("PrivateIpAddress"),
                        "public_ip": inst.get("PublicIpAddress"),
                    }
                )

                type_counts[instance_type] = type_counts.get(instance_type, 0) + 1
                region_counts[region] = region_counts.get(region, 0) + 1
                if state == "running":
                    running_count += 1
                elif state == "stopped":
                    stopped_count += 1

    # Sort by CPU usage descending (most utilized first), running instances first
    instances.sort(
        key=lambda i: (i["state"] != "running", -(i["avg_cpu_pct_24h"] or -1))
    )

    most_used = [i for i in instances if i["state"] == "running"][:5]

    return {
        "instances": instances,
        "total_count": len(instances),
        "running_count": running_count,
        "stopped_count": stopped_count,
        "by_type": [{"type": k, "count": v} for k, v in sorted(type_counts.items(), key=lambda kv: -kv[1])],
        "by_region": [{"region": k, "count": v} for k, v in sorted(region_counts.items(), key=lambda kv: -kv[1])],
        "most_utilized": most_used,
        "scanned_regions": regions,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


def fetch_service_usage_breakdown(days: int = 30) -> dict[str, Any]:
    """
    Deep breakdown of AWS spend by SERVICE + USAGE_TYPE + REGION, using real
    Cost Explorer data (not estimated). This goes beyond the existing
    service-only breakdown in aws.py — for each service it also lists
    region split and the specific usage types driving the cost (e.g.
    "BoxUsage:t3.medium" under EC2), so you can see exactly what's being
    used, not just which top-level service.
    """
    ce = _ce_client()
    today = date.today()
    start = today - timedelta(days=days)

    resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": (today + timedelta(days=1)).isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost", "UsageQuantity"],
        GroupBy=[
            {"Type": "DIMENSION", "Key": "SERVICE"},
            {"Type": "DIMENSION", "Key": "USAGE_TYPE"},
        ],
    )

    service_breakdown: dict[str, dict[str, Any]] = {}

    for period in resp["ResultsByTime"]:
        for group in period["Groups"]:
            service, usage_type = group["Keys"]
            cost = float(group["Metrics"]["UnblendedCost"]["Amount"])
            qty = float(group["Metrics"]["UsageQuantity"]["Amount"])

            if cost <= 0:
                continue

            entry = service_breakdown.setdefault(
                service, {"service": service, "total_cost": 0.0, "usage_types": []}
            )
            entry["total_cost"] += cost
            entry["usage_types"].append(
                {"usage_type": usage_type, "cost": round(cost, 2), "quantity": round(qty, 2)}
            )

    # Region split via a separate, simpler query (SERVICE + REGION together
    # would explode group cardinality, so this is queried independently)
    region_resp = ce.get_cost_and_usage(
        TimePeriod={"Start": start.isoformat(), "End": (today + timedelta(days=1)).isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "REGION"}],
    )
    region_costs: dict[str, float] = {}
    for period in region_resp["ResultsByTime"]:
        for group in period["Groups"]:
            region_name = group["Keys"][0]
            cost = float(group["Metrics"]["UnblendedCost"]["Amount"])
            if cost > 0:
                region_costs[region_name] = region_costs.get(region_name, 0.0) + cost

    services_list = sorted(service_breakdown.values(), key=lambda s: -s["total_cost"])
    for s in services_list:
        s["total_cost"] = round(s["total_cost"], 2)
        s["usage_types"] = sorted(s["usage_types"], key=lambda u: -u["cost"])[:8]

    total_cost = sum(s["total_cost"] for s in services_list) or 1.0

    return {
        "services": [
            {**s, "pct": round(s["total_cost"] / total_cost * 100, 1)} for s in services_list
        ],
        "active_service_count": len(services_list),
        "regions": [
            {"region": r, "cost": round(c, 2), "pct": round(c / total_cost * 100, 1)}
            for r, c in sorted(region_costs.items(), key=lambda kv: -kv[1])
        ],
        "window_days": days,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }