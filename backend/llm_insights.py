import logging
import time

import httpx

logger = logging.getLogger("spendwatch.llm_insights")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
GEMINI_FALLBACK_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3


from fx import get_usd_exchange_rate

def generate_ai_summary(insights: list[dict], api_key: str) -> str | None:
    """
    Takes the already-computed insights list (same data already shown on
    the Insights page) and asks Gemini to write ONE short paragraph
    synthesizing them for a non-technical reader. Returns None on any
    failure so the caller can gracefully skip showing the summary card.
    """
    if not api_key or not insights:
        return None

    bullet_points = "\n".join(
        f"- {item['provider_label']}: {item['explanation']}"
        for item in insights
    )

    prompt = (
        "You are explaining company spending to an executive in India. Below are today's "
        "spending alerts, written in plain English. Write ONE short paragraph (3-4 short "
        "sentences, very simple everyday words) that covers: the single "
        "most important thing to know, roughly how much money is "
        "involved in total, and whether anything needs action today. "
        "ALWAYS use Indian Rupees (₹) for all monetary amounts and totals. NEVER use dollars ($) or USD. "
        "Do not invent any numbers not present below. Do not use technical "
        "terms or jargon of any kind. Be direct and calm, not alarmist.\n\n"
        f"{bullet_points}"
    )

    payload = {"contents": [{"parts": [{"text": prompt}]}]}

    # Try the primary model with retries, then fall back to a lighter model.
    for url in (GEMINI_URL, GEMINI_FALLBACK_URL):
        text = _call_gemini_with_retry(url, api_key, payload)
        if text is not None:
            return text

    return None


def generate_all_clear_summary(snapshots: list[dict], api_key: str) -> str | None:
    """
    Takes real per-provider spend snapshots (today, month-to-date, %
    change vs last month) and asks Gemini for a short, calm, plain-English
    paragraph in INR — used when there are zero anomalies.
    """
    if not api_key or not snapshots:
        return None

    rate = get_usd_exchange_rate("INR")

    lines = []
    for s in snapshots:
        label = s.get("label", s.get("provider"))
        if s.get("provider") in ("ms365", "e2e"):
            parts = []
            if s.get("today") is not None:
                parts.append(f"{label}: today ₹{s['today']:,.2f} INR")
            if s.get("month_to_date") is not None:
                parts.append(f"month-to-date ₹{s['month_to_date']:,.2f} INR")
            if s.get("monthly_bill") is not None:
                parts.append(f"monthly bill ₹{s['monthly_bill']:,.2f} INR")
            if not parts:
                parts = [f"{label}:"]
        else:
            today_inr = (s['today'] or 0) * rate if s.get('today') is not None else None
            mtd_inr = (s['month_to_date'] or 0) * rate if s.get('month_to_date') is not None else None
            parts = [f"{label}: today ₹{today_inr:,.2f} INR" if today_inr is not None else f"{label}:"]
            if mtd_inr is not None:
                parts.append(f"month-to-date ₹{mtd_inr:,.2f} INR")
        if s.get("vs_last_month_pct") is not None:
            parts.append(f"{s['vs_last_month_pct']:+.1f}% vs last month")
        lines.append(", ".join(parts))
    bullet_points = "\n".join(f"- {line}" for line in lines)

    prompt = (
        "You are explaining cloud and software spending to an executive in India. "
        "There are no unusual alerts today — everything is normal. Below are today's "
        "real spending numbers in Indian Rupees (₹) for each service. Write ONE short "
        "paragraph (3-4 short sentences) in very simple, everyday words. Say things are "
        "running normally, then mention the total spend and one or two notable numbers "
        "from the list. ALWAYS use Indian Rupees (₹) for all monetary amounts and totals. "
        "NEVER use dollars ($) or USD. Use only the numbers given below — never invent or "
        "estimate a number. Do not use technical terms. This is a routine, reassuring update.\n\n"
        f"{bullet_points}"
    )

    payload = {"contents": [{"parts": [{"text": prompt}]}]}

    for url in (GEMINI_URL, GEMINI_FALLBACK_URL):
        text = _call_gemini_with_retry(url, api_key, payload)
        if text is not None:
            return text

    return None


def _call_gemini_with_retry(url: str, api_key: str, payload: dict) -> str | None:
    for attempt in range(_MAX_RETRIES):
        try:
            response = httpx.post(
                url,
                params={"key": api_key},
                json=payload,
                timeout=8.0,
            )
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return text.strip()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in _RETRYABLE_STATUS_CODES and attempt < _MAX_RETRIES - 1:
                logger.warning(
                    "Gemini summary attempt %d/%d failed with %d, retrying...",
                    attempt + 1, _MAX_RETRIES, status,
                )
                time.sleep(2 ** attempt)  # 1s, 2s
                continue
            logger.warning("Gemini summary generation failed with status %d", status)
            return None
        except Exception:
            logger.warning("Gemini summary generation failed", exc_info=False)
            return None
    return None