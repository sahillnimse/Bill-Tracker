import logging
import httpx

logger = logging.getLogger("spendwatch.llm_insights")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"


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

    try:
        response = httpx.post(
            GEMINI_URL,
            params={"key": api_key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=8.0,
        )
        response.raise_for_status()
        data = response.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return text.strip()
    except Exception as exc:
        logger.warning("Gemini summary generation failed: %s", exc)
        return None