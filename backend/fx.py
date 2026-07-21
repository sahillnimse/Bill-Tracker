"""
Shared USD exchange-rate helper. Any provider that bills natively in a
non-USD currency (Google Ads for INR accounts, Microsoft 365, E2E
Networks) should convert to USD at the point of ingestion using this,
so every number stored/returned by the backend is in USD — the frontend
then converts USD -> INR for display via CurrencyContext when the user
toggles the header currency switch.
"""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("spendwatch.fx")

_FALLBACK_RATES = {"INR": 84.0, "EUR": 0.92, "GBP": 0.78}


def get_usd_exchange_rate(currency_code: str) -> float:
    """
    Returns how many units of `currency_code` equal 1 USD (e.g. ~84 for
    INR). Returns 1.0 for USD. Falls back to a fixed approximate rate if
    the live lookup fails.
    """
    if currency_code == "USD":
        return 1.0
    try:
        resp = httpx.get("https://open.er-api.com/v6/latest/USD", timeout=5)
        if resp.status_code == 200:
            rate = resp.json().get("rates", {}).get(currency_code)
            if rate:
                return float(rate)
    except Exception as exc:
        logger.warning("Failed to fetch exchange rate for %s: %s. Using fallback.", currency_code, exc)
    return _FALLBACK_RATES.get(currency_code, 1.0)


def to_usd(amount: float, currency_code: str) -> float:
    """Converts `amount` in `currency_code` to USD."""
    if currency_code == "USD" or not amount:
        return amount
    rate = get_usd_exchange_rate(currency_code)
    return amount / rate