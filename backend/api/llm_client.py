"""LLM coach client with a provider switch and an always-available fallback.

Uses only the standard library — the API Lambda ships no packaged
dependencies, so there is no SDK to install.

Provider is chosen by the LLM_PROVIDER env var (gemini | mock). Anything that
goes wrong — missing key, timeout, HTTP error, malformed output — falls back to
safe plan-aware text, so the coach layer can never break a prediction response.
"""

import json
import os
import time
import urllib.error
import urllib.request

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

# A check-in already spends time on SageMaker inference (about a second warm,
# up to ~10s on a cold container) and the app aborts at 20s, so this can't be
# generous. 6s turned out to be too tight for a ~3.5k-char prompt and the
# request timed out every time; 12s leaves room while still falling back
# before the client gives up. Tunable without a redeploy.
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("LLM_TIMEOUT_SECONDS", "12"))

REQUIRED_COACH_FIELDS = ("summary", "explanation", "coaching_message", "follow_up_question")
MAX_FIELD_CHARS = 600

MAX_OUTPUT_TOKENS = int(os.environ.get("LLM_MAX_OUTPUT_TOKENS", "1200"))
# A session plus a seven-day outline is a much larger response than four short
# prose fields, and running out of budget on a thinking model returns *empty
# content*, not a truncated object. Kept separate so the prose-only path keeps
# its own proven ceiling.
PLAN_MAX_OUTPUT_TOKENS = int(os.environ.get("LLM_PLAN_MAX_OUTPUT_TOKENS", "2500"))
THINKING_BUDGET = int(os.environ.get("LLM_THINKING_BUDGET", "0"))

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

# Prose plus a structured plan. Nothing here is trusted: every plan field is
# re-checked against the envelope by exercise_plan.validate_plan(), and the
# schema only shapes the response so that validation has something to check.
PLAN_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        **RESPONSE_SCHEMA["properties"],
        "exercise_plan": {
            "type": "OBJECT",
            "properties": {
                "session_focus": {"type": "STRING"},
                "blocks": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "phase": {"type": "STRING", "enum": ["warmup", "main", "cooldown"]},
                            "activity": {"type": "STRING"},
                            "minutes": {"type": "INTEGER"},
                            "intensity": {
                                "type": "STRING",
                                "enum": ["none", "very_low", "low", "moderate"],
                            },
                            "target_rpe": {"type": "INTEGER"},
                            "cue": {"type": "STRING"},
                        },
                        "required": ["phase", "activity", "minutes", "intensity"],
                    },
                },
                "stop_rules": {"type": "ARRAY", "items": {"type": "STRING"}},
                "progression_note": {"type": "STRING"},
            },
            "required": ["session_focus", "blocks", "stop_rules"],
        },
        "week_plan": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "day": {"type": "INTEGER"},
                    "activity": {"type": "STRING"},
                    "durationMinutes": {"type": "INTEGER"},
                    "intensity": {
                        "type": "STRING",
                        "enum": ["none", "very_low", "low", "moderate"],
                    },
                    "focus": {"type": "STRING"},
                },
                "required": ["day", "activity", "durationMinutes", "intensity"],
            },
        },
    },
    "required": list(REQUIRED_COACH_FIELDS) + ["exercise_plan", "week_plan"],
}


def _provider():
    return os.environ.get("LLM_PROVIDER", "mock").strip().lower()


def _build_payload(prompt, with_thinking_config, schema=None, max_tokens=None):
    generation_config = {
        "temperature": 0.2,
        # Must comfortably exceed the four short fields. On a thinking model
        # this budget also covers reasoning tokens: at 400 the model spent 384
        # of them thinking, hit MAX_TOKENS and returned empty content.
        "maxOutputTokens": max_tokens or MAX_OUTPUT_TOKENS,
        "responseMimeType": "application/json",
        "responseSchema": schema or RESPONSE_SCHEMA,
    }
    if with_thinking_config:
        # Explaining an already-decided plan needs no reasoning phase. Turning
        # it off removes the token contention and cuts several seconds.
        generation_config["thinkingConfig"] = {"thinkingBudget": THINKING_BUDGET}
    return {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": generation_config,
    }


def _post(model, api_key, payload):
    request = urllib.request.Request(
        url=f"{GEMINI_ENDPOINT}/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        # Key in a header, not the query string, so it can't land in an access log.
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Gemini HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini network error: {exc.reason}") from exc


def call_gemini(prompt, schema=None, max_tokens=None):
    """POST the prompt to Gemini and return the parsed JSON object."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")
    model = os.environ.get("GEMINI_MODEL")
    if not model:
        raise RuntimeError("GEMINI_MODEL is not set.")
    # The models API returns names as "models/gemini-…"; accept either form.
    model = model.strip().removeprefix("models/")

    started = time.time()
    try:
        raw = _post(model, api_key, _build_payload(
            prompt, with_thinking_config=True, schema=schema, max_tokens=max_tokens))
    except RuntimeError as exc:
        # Not every model accepts thinkingConfig, and the ones that reject it
        # do not always say so: gemini-3.6-flash answers a plain 400
        # "Request contains an invalid argument" with no field named, so
        # matching on the word "thinking" never fired and the call fell
        # straight to the canned fallback. Any 400 is worth one retry without
        # it — the cost of being wrong is a single extra request.
        message = str(exc).lower()
        if "thinking" not in message and "http 400" not in message:
            raise
        print(json.dumps({
            "level": "INFO",
            "message": "retrying_without_thinking_config",
            "model": model,
            "firstError": str(exc)[:200],
        }))
        raw = _post(model, api_key, _build_payload(
            prompt, with_thinking_config=False, schema=schema, max_tokens=max_tokens))

    candidate = (raw.get("candidates") or [{}])[0]
    finish_reason = candidate.get("finishReason")
    print(json.dumps({
        "level": "INFO",
        "message": "coach_generated",
        "model": model,
        "durationMs": round((time.time() - started) * 1000, 1),
        "finishReason": finish_reason,
        "thoughtTokens": (raw.get("usageMetadata") or {}).get("thoughtsTokenCount"),
    }))

    try:
        text = candidate["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        # Empty content: usually MAX_TOKENS (reasoning consumed the budget) or
        # a safety block. finishReason tells them apart.
        raise RuntimeError(
            f"No content from Gemini (finishReason={finish_reason}): {json.dumps(raw)[:300]}"
        ) from exc

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
    """Return (coach_prose, source). Never raises.

    `source` is what actually produced the text — "gemini" or "fallback" — not
    the configured provider. Those differ whenever generation fails, and the
    caller (and the UI) needs the real answer, otherwise a failed call is
    indistinguishable from a successful one.
    """
    provider = _provider()
    if provider == "mock":
        return fallback_coach_response(plan), "fallback"

    try:
        if provider == "gemini":
            return validate_coach_response(call_gemini(prompt)), "gemini"
        raise RuntimeError(f"Unknown LLM_PROVIDER: {provider}")
    except Exception as exc:
        print(json.dumps({
            "level": "ERROR",
            "message": "coach_generation_failed",
            "provider": provider,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return fallback_coach_response(plan), "fallback"


def generate_coach_message_with_plan(prompt, plan=None):
    """Return (coach_prose, raw_plan, source). Never raises.

    `raw_plan` is whatever the model returned under exercise_plan / week_plan,
    entirely unvalidated — the caller must put it through
    exercise_plan.validate_plan() before anything renders it. It is None
    whenever generation fell back, so a caller that ignores validation still
    cannot render unchecked model output.

    Prose failure discards the plan too. The two are generated together from
    one prompt, so prose that failed validation is evidence the response as a
    whole is not trustworthy.
    """
    provider = _provider()
    if provider == "mock":
        return fallback_coach_response(plan), None, "fallback"

    try:
        if provider != "gemini":
            raise RuntimeError(f"Unknown LLM_PROVIDER: {provider}")
        raw = call_gemini(
            prompt,
            schema=PLAN_RESPONSE_SCHEMA,
            max_tokens=PLAN_MAX_OUTPUT_TOKENS,
        )
        prose = validate_coach_response(raw)
        return prose, {
            "exercise_plan": raw.get("exercise_plan"),
            "week_plan": raw.get("week_plan"),
        }, "gemini"
    except Exception as exc:
        print(json.dumps({
            "level": "ERROR",
            "message": "coach_plan_generation_failed",
            "provider": provider,
            "error": f"{type(exc).__name__}: {exc}",
        }))
        return fallback_coach_response(plan), None, "fallback"
