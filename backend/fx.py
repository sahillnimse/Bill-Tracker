"""
Shared currency / exchange-rate helper.
All five providers return monetary values in INR.  Providers that bill in
USD (AWS, RunPod) use `to_inr()` to convert at fetch time; providers that
bill in a non-USD native currency (Google Ads) use `to_inr_from_currency()`
for a direct conversion.  E2E Networks and Microsoft 365 bill natively in
INR and need no conversion.
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


def to_inr(amount_usd: float) -> float:
    """Converts `amount_usd` from USD to INR using live rate (or fallback)."""
    if not amount_usd:
        return 0.0
    rate = get_usd_exchange_rate("INR")
    return amount_usd * rate


def to_inr_from_currency(amount: float, currency_code: str) -> float:
    """Converts `amount` in `currency_code` to INR."""
    if not amount or currency_code == "INR":
        return amount or 0.0
    if currency_code == "USD":
        return to_inr(amount)
    usd = to_usd(amount, currency_code)
    return to_inr(usd)