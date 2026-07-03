"""
Central config. All secrets come from .env (see .env.example) — never hardcode
credentials in code. Each provider module pulls only the settings it needs.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _get(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def _get_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class AWSConfig:
    access_key_id: str = _get("AWS_ACCESS_KEY_ID")
    secret_access_key: str = _get("AWS_SECRET_ACCESS_KEY")
    region: str = _get("AWS_REGION", "us-east-1")


@dataclass(frozen=True)
class RunPodConfig:
    api_key: str = _get("RUNPOD_API_KEY")



@dataclass(frozen=True)
class GoogleAdsConfig:
    developer_token: str = _get("GOOGLE_ADS_DEVELOPER_TOKEN")
    client_id: str = _get("GOOGLE_ADS_CLIENT_ID")
    client_secret: str = _get("GOOGLE_ADS_CLIENT_SECRET")
    refresh_token: str = _get("GOOGLE_ADS_REFRESH_TOKEN")
    login_customer_id: str = _get("GOOGLE_ADS_LOGIN_CUSTOMER_ID")
    customer_id: str = _get("GOOGLE_ADS_CUSTOMER_ID")


@dataclass(frozen=True)
class Microsoft365Config:
    tenant_id: str = _get("MS365_TENANT_ID")
    client_id: str = _get("MS365_CLIENT_ID")
    client_secret: str = _get("MS365_CLIENT_SECRET")

    # USD list prices (source of truth, backend always computes in USD).
    # Updated to Microsoft's July 1, 2026 US list pricing.
    basic_license_cost: float = _get_float("MS365_BASIC_LICENSE_COST", 7.0)      # was 6.0
    standard_license_cost: float = _get_float("MS365_STANDARD_LICENSE_COST", 14.0)  # new tier, was missing
    premium_license_cost: float = _get_float("MS365_PREMIUM_LICENSE_COST", 22.0)    # unchanged


@dataclass(frozen=True)
class GoogleWorkspaceConfig:
    admin_email: str = _get("GWORKSPACE_ADMIN_EMAIL")
    service_account_json: str = _get("GWORKSPACE_SERVICE_ACCOUNT_JSON_PATH")
    seats: int = _get_int("GWORKSPACE_SEATS", 0)
    cost_per_seat: float = _get_float("GWORKSPACE_COST_PER_SEAT", 12.0)
    domain: str = _get("GWORKSPACE_DOMAIN")


@dataclass(frozen=True)
class SMTPConfig:
    sender_email: str = _get("SMTP_SENDER_EMAIL")
    app_password: str = _get("SMTP_APP_PASSWORD")
    recipients: str = _get("ALERT_RECIPIENTS")  # comma-separated


@dataclass(frozen=True)
class AppConfig:
    cache_ttl_seconds: int = _get_int("CACHE_TTL_SECONDS", 900)  # 15 min default
    z_score_threshold: float = _get_float("Z_SCORE_THRESHOLD", 2.0)
    min_dollar_delta: float = _get_float("MIN_DOLLAR_DELTA", 5.0)
    baseline_window_days: int = _get_int("BASELINE_WINDOW_DAYS", 14)
    cors_origin: str = _get("CORS_ORIGIN", "http://localhost:5173")


aws_config = AWSConfig()
runpod_config = RunPodConfig()
google_ads_config = GoogleAdsConfig()
ms365_config = Microsoft365Config()
gworkspace_config = GoogleWorkspaceConfig()
smtp_config = SMTPConfig()
app_config = AppConfig()