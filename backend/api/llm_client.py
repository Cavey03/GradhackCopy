"""LLM coach client with a provider switch and an always-available fallback.

Uses only the standard library — the API Lambda ships no packaged
dependencies, so there is no SDK to install.

Provider is chosen by the LLM_PROVIDER env var (gemini | mock). Anything that
goes wrong — missing key, timeout, HTTP error, malformed output — falls back to
safe plan-aware text, so the coach layer can never break a prediction response.
"""

import json
import os
import urllib.error
import urllib.request

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

# Kept short on purpose. A check-in already spends time on SageMaker inference
# (up to ~10s on a cold container) and the app aborts at 20s. Better to fall
# back to canned coach text than to blow the client's timeout budget.
REQUEST_TIMEOUT_SECONDS = 6

REQUIRED_COACH_FIELDS = ("summary", "explanation", "coaching_message", "follow_up_question")
MAX_FIELD_CHARS = 600

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "summary": {"type": "STRING"},
        "explanation": {"type": "STRING"},
        "coaching_message": {"type": "STRING"},
        "follow_up_question": {"type": "STRING"},
    },
    "required": list(REQUIRED_COACH_FIELDS),
}


def _provider():
    return os.environ.get("LLM_PROVIDER", "mock").strip().lower()


def call_gemini(prompt):
    """POST the prompt to Gemini and return the parsed JSON object."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    model = os.environ.get("GEMINI_MODEL")
    if not model:
        raise RuntimeError("GEMINI_MODEL is not set.")

    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 500,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }

    request = urllib.request.Request(
        url=f"{GEMINI_ENDPOINT}/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        # Key in a header, not the query string, so it can't land in an access log.
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Gemini HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini network error: {exc.reason}") from exc

    try:
        text = raw["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        # Usually a safety block or an empty candidate list.
        raise RuntimeError(f"Unexpected Gemini response shape: {json.dumps(raw)[:400]}") from exc

    return json.loads(text)


def validate_coach_response(response):
    """Keep only the four prose fields, as bounded strings."""
    if not isinstance(response, dict):
        raise ValueError("Coach response must be a JSON object.")

    missing = [field for field in REQUIRED_COACH_FIELDS if not response.get(field)]
    if missing:
        raise ValueError(f"Missing coach fields: {missing}")

    return {
        field: " ".join(str(response[field]).split())[:MAX_FIELD_CHARS]
        for field in REQUIRED_COACH_FIELDS
    }


def fallback_coach_response(plan=None):
    """Safe text used whenever generation fails.

    Deliberately never names an activity or duration: the previous hardcoded
    copy said "complete a 20-minute low-intensity walk", which contradicted the
    model on any REDUCE/rest day.
    """
    plan = plan or {}
    if plan.get("is_rest_day"):
        return {
            "summary": "Today is a recovery day.",
            "explanation": "Your latest check-in and recent training signals indicate that adding load today would not be appropriate.",
            "coaching_message": "Rest today and reassess at your next check-in.",
            "follow_up_question": "Would you like to see the signals behind this decision?",
        }
    return {
        "summary": "Your updated recovery plan is ready.",
        "explanation": "This recommendation is based on your current recovery assessment and your recent activity and wearable data.",
        "coaching_message": "Follow the activity, duration and intensity shown in your plan, and stop if symptoms worsen.",
        "follow_up_question": "Would you like to review the factors behind this recommendation?",
    }


def generate_coach_message(prompt, plan=None):
    """Return validated coach prose. Never raises."""
    provider = _provider()
    if provider == "mock":
        return fallback_coach_response(plan)

    try:
        if provider == "gemini":
            return validate_coach_response(call_gemini(prompt))
        raise RuntimeError(f"Unknown LLM_PROVIDER: {provider}")
    except Exception as exc:
        print(json.dumps({
            "level": "ERROR",
            "message": "coach_generation_failed",
            "provider": provider,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return fallback_coach_response(plan)
