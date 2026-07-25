"""What-if evaluation: judge a proposed activity against the model's envelope.

This replaces a keyword heuristic that returned hardcoded probabilities (0.44
for "risky", 0.19 otherwise) and never invoked a model. Those numbers were
constants, so the answer could not respond to the member's actual state and
could contradict the plan shown on the next screen.

Everything here is deterministic. Parsing is regex over the member's own
question and the verdict is a comparison against the same envelope that bounds
the exercise plan, so a what-if answer and a plan can never disagree. No LLM is
involved: a safety judgement should not depend on generated text, and this way
the endpoint costs nothing to call.

The one number quoted is the model's real P(REDUCE) for today. There is
deliberately no "probability if you do this instead" — the readiness model
predicts the next session from history, not the outcome of a hypothetical, so
any such figure would be invented.
"""

import re

from exercise_plan import INTENSITY_ORDER

# Question text -> plan vocabulary. Ordered longest-first within each activity
# so "jogging" is not matched by a stray "jog" rule elsewhere.
ACTIVITY_WORDS = [
    ("run", ("running", "run ", "runs", "jog", "sprint", "5k", "10k", "marathon", "parkrun", "race")),
    ("swim", ("swimming", "swim", "pool", "lengths", "laps", "aqua")),
    ("cycle", ("cycling", "cycle", "bike", "biking", "spin class", "spinning", "ride")),
    ("walk", ("walking", "walk", "hike", "hiking", "stroll", "ramble")),
    ("mobility", ("mobility", "stretch", "stretching", "yoga", "pilates", "foam roll")),
    ("breathing", ("breathing", "breathwork", "meditation", "box breathing")),
]

# Recognisable but outside the models' vocabulary. Named so the answer can say
# what it is rather than silently guessing, and flagged as strenuous where the
# activity plainly is.
UNMODELLED = {
    "squat": "weight training", "deadlift": "weight training", "lift": "weight training",
    "weights": "weight training", "gym": "gym session", "hiit": "HIIT",
    "crossfit": "CrossFit", "football": "team sport", "soccer": "team sport",
    "rugby": "team sport", "netball": "team sport", "tennis": "racket sport",
    "squash": "racket sport", "padel": "racket sport", "match": "competitive fixture",
    "game": "competitive fixture", "gig": "live performance", "band": "live performance",
    "performance": "live performance", "concert": "live performance",
    "dance": "dancing", "boxing": "boxing",
}

INTENSITY_WORDS = [
    ("moderate", ("high-intensity", "high intensity", "hard", "intense", "heavy",
                  "vigorous", "fast", "tempo", "threshold", "moderate", "push")),
    ("low", ("steady", "comfortable", "conversational", "low intensity", "low-intensity", "easy")),
    ("very_low", ("gentle", "very easy", "very light", "light", "slow")),
]

STRENUOUS = {"weight training", "HIIT", "CrossFit", "team sport", "racket sport",
             "competitive fixture", "boxing"}

# "Should I rest or push through?" names no activity, but it is not
# unanswerable — today's classification *is* the answer.
REST_QUESTION_WORDS = ("rest", "push through", "day off", "take it easy",
                       "should i train", "should i exercise", "overdo", "back off")


def _minutes(text):
    """Duration in minutes, or None. Handles '40 min', '1 hour', '1.5 hours'."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr|h)\b", text)
    if m:
        return int(round(float(m.group(1)) * 60))
    m = re.search(r"(\d+)\s*(?:minutes|minute|mins|min|m)\b", text)
    if m:
        return int(m.group(1))
    return None


def _distance_km(text):
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:kilometres|kilometers|km|k)\b", text)
    return float(m.group(1)) if m else None


def parse_proposal(question, override=None):
    """Turn a free-text question into a structured proposal.

    The parse is echoed back to the member so a misread is visible rather than
    silently driving the verdict.
    """
    if override:
        return {
            "activity": override.get("activity"),
            "unmodelled": None,
            "durationMinutes": override.get("durationMinutes"),
            "intensity": override.get("intensity"),
            "distanceKm": override.get("distanceKm"),
            "source": "supplied",
        }

    text = f" {(question or '').lower().strip()} "

    activity = None
    for name, words in ACTIVITY_WORDS:
        if any(w in text for w in words):
            activity = name
            break

    unmodelled = None
    for word, label in UNMODELLED.items():
        if word in text:
            unmodelled = label
            break

    intensity = None
    for name, words in INTENSITY_WORDS:
        if any(w in text for w in words):
            intensity = name
            break

    return {
        "activity": activity,
        "unmodelled": unmodelled,
        "durationMinutes": _minutes(text),
        "intensity": intensity,
        "distanceKm": _distance_km(text),
        "source": "parsed",
    }


def _describe(proposal):
    bits = []
    if proposal.get("durationMinutes"):
        bits.append(f"{proposal['durationMinutes']} min")
    if proposal.get("distanceKm"):
        bits.append(f"{proposal['distanceKm']:g} km")
    name = proposal.get("activity") or proposal.get("unmodelled") or "that activity"
    bits.append(name.replace("_", " "))
    if proposal.get("intensity"):
        bits.append(f"at {proposal['intensity'].replace('_', ' ')} intensity")
    return " ".join(bits)


def evaluate(question, override, prediction, envelope, recommended):
    """Compare a proposal against the envelope. Returns the API response body.

    `recommended` is the plan the app is already showing, so the safer
    alternative offered here is the real one rather than a second opinion.
    """
    proposal = parse_proposal(question, override)
    reasons = []
    described = _describe(proposal)

    setback = prediction.get("setback_probability")
    risk_pct = round(float(setback) * 100) if setback is not None else None
    readiness = envelope.get("readiness")
    allowed = envelope.get("allowed_activities") or []
    max_minutes = envelope.get("max_total_minutes", 0)
    max_intensity = envelope.get("max_intensity", "none")

    # ---- verdict ----
    if envelope.get("is_rest_day"):
        verdict = "not_advised"
        reasons.append({"code": "REST_DAY",
                        "detail": "The readiness model has today down as a full rest day."})
    elif (proposal["activity"] is None and proposal["unmodelled"] is None
          and any(w in f" {(question or '').lower()} " for w in REST_QUESTION_WORDS)):
        verdict = "follow_plan"
        reasons.append({
            "code": "PLAN_ANSWERS_THIS",
            "detail": (f"You are classified {readiness} today, which is not a rest day. "
                       f"Training within today's plan is appropriate; going beyond it is not."),
        })
    elif proposal["activity"] is None and proposal["unmodelled"] is None:
        verdict = "not_assessable"
        reasons.append({"code": "NOT_UNDERSTOOD",
                        "detail": "The question did not name an activity this system models."})
    elif proposal["activity"] is None:
        # Recognised, but the models were never trained on it.
        verdict = "not_advised" if proposal["unmodelled"] in STRENUOUS else "not_assessable"
        reasons.append({
            "code": "OUTSIDE_MODEL_SCOPE",
            "detail": (f"{proposal['unmodelled'].capitalize()} is not something these models "
                       f"were trained on. They cover walking, running, swimming, cycling, "
                       f"mobility and breathing."),
        })
        if proposal["unmodelled"] in STRENUOUS:
            reasons.append({"code": "STRENUOUS_UNMODELLED",
                            "detail": "It is also more strenuous than anything today's plan permits."})
    elif proposal["activity"] not in allowed:
        verdict = "not_advised"
        reasons.append({
            "code": "ACTIVITY_NOT_PERMITTED",
            "detail": (f"{proposal['activity'].capitalize()} is not permitted today. "
                       f"Your {readiness} classification allows "
                       f"{', '.join(allowed) if allowed else 'rest only'}."),
        })
    else:
        verdict = "advised"
        if proposal["durationMinutes"] and proposal["durationMinutes"] > max_minutes:
            verdict = "modify"
            reasons.append({
                "code": "DURATION_EXCEEDS",
                "detail": (f"{proposal['durationMinutes']} minutes is over today's ceiling "
                           f"of {max_minutes}."),
            })
        if proposal["intensity"] and (
            INTENSITY_ORDER.get(proposal["intensity"], 0) > INTENSITY_ORDER.get(max_intensity, 0)
        ):
            verdict = "modify"
            reasons.append({
                "code": "INTENSITY_EXCEEDS",
                "detail": (f"{proposal['intensity'].replace('_', ' ').capitalize()} is above "
                           f"today's ceiling of {max_intensity.replace('_', ' ')}."),
            })
        if verdict == "advised":
            reasons.append({
                "code": "WITHIN_ENVELOPE",
                "detail": f"That sits inside today's limits of {max_minutes} min at "
                          f"{max_intensity.replace('_', ' ')}.",
            })

    # ---- headline + prose, assembled from the reasons above ----
    headlines = {
        "advised": "SAFE TO PROCEED",
        "modify": "MODIFY BEFORE PROCEEDING",
        "not_advised": "NOT ADVISED TODAY",
        "not_assessable": "OUTSIDE WHAT THIS MODEL COVERS",
        "follow_plan": "FOLLOW TODAY'S PLAN",
    }
    rec_text = (
        "rest" if recommended.get("activity") == "rest" else
        f"{recommended.get('durationMinutes')} min {recommended.get('activity')} "
        f"at {str(recommended.get('intensity') or '').replace('_', ' ')} intensity"
    )
    risk_text = (f"Your readiness model puts today's setback risk at {risk_pct}% "
                 f"({readiness}).") if risk_pct is not None else ""

    explanation = " ".join(filter(None, [
        f"You asked about {described}.",
        " ".join(r["detail"] for r in reasons),
        risk_text,
        f"Today's plan is {rec_text}.",
    ]))

    return {
        "question": question,
        "proposed": proposal,
        "verdict": verdict,
        "headline": headlines[verdict],
        "explanation": explanation,
        "reasons": reasons,
        "model": {
            "readiness": readiness,
            "setback_probability": setback,
            "confidence": prediction.get("confidence"),
            "recovery_score": prediction.get("recovery_score"),
            "model_version": prediction.get("model_version"),
        },
        "envelope": {
            "max_total_minutes": max_minutes,
            "max_intensity": max_intensity,
            "max_rpe": envelope.get("max_rpe"),
            "allowed_activities": allowed,
            "is_rest_day": envelope.get("is_rest_day"),
        },
        "recommended": recommended,
    }
