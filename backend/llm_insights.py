import logging
import time

import httpx

logger = logging.getLogger("spendwatch.llm_insights")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
GEMINI_FALLBACK_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent"

_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3


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
        "You are explaining company cloud spending to a manager with zero "
        "technical background. Below are today's spending alerts, already "
        "written in plain English. Write ONE short paragraph (3-4 "
        "sentences max) that summarizes the overall picture: what's the "
        "most important thing to know, roughly how much money is "
        "involved in total, and is anything urgent. Do not invent any "
        "numbers not present below. Do not use jargon. Be direct and "
        "calm, not alarmist.\n\n"
        f"{bullet_points}"
    )

    payload = {"contents": [{"parts": [{"text": prompt}]}]}

    # Try the primary model with retries, then fall back to a lighter model.
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