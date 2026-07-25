"""Structured exercise plan: a deterministic safety envelope plus LLM detail.

Until now the coaching LLM could not emit plan fields at all, so it was
structurally incapable of contradicting the model's safety decision. This
module lets the LLM design the *detail* of a session while preserving an
equivalent guarantee by other means:

  1. `plan_envelope()` computes what the member is permitted to do today, from
     the model's readiness class and hard clinical flags only. The LLM never
     influences it — it is built before the LLM is called.
  2. The LLM designs a session inside that envelope.
  3. `validate_plan()` re-checks every block against the envelope and rejects
     the whole plan on any violation. There is no repair path: a plan is either
     inside the envelope or it is discarded.
  4. `rules_plan()` is what gets rendered when a plan is rejected — the
     deterministic `_plan_activity()` output the app already ships today.

The ceilings below are deliberately the same arithmetic as `_plan_activity()`
in the SageMaker inference script, so an LLM-authored plan can only ever be at
or below what the rules already permit.

Week plans: the readiness model predicts the *next* session and the VO2 model
forecasts four sessions ahead. Neither predicts day five. Days 2-7 are
therefore provisional — capped per day by `week_day_max_minutes`, allowed to
taper upward only when the model said PROGRESS and the VO2 forecast agrees,
and regenerated from scratch on every check-in and every logged activity.
"""

from decimal import Decimal

PLAN_VERSION = "plan-v1"

# Ordered so a cap can be enforced with a simple comparison.
INTENSITY_ORDER = {"none": 0, "very_low": 1, "low": 2, "moderate": 3}

# The activity vocabulary the plan may use. "rest" is always permissible;
# everything else must appear in the envelope's allowed list.
KNOWN_ACTIVITIES = {"rest", "walk", "mobility", "breathing", "cycle", "swim", "run"}

# Dropped from the allowed list when the member has a mobility limitation.
IMPACT_ACTIVITIES = {"run"}

# What each recorded limitation actually constrains. Previously every value
# did the same thing - drop running - so "Short bouts only" permitted a
# 45-minute session and "Pool-based preferred" did not make swimming
# available. Matching is on a substring of the casefolded text so wording
# variants still land on a rule.
#
#   drop         activities removed from the allowed set
#   add          activities made available (only where the text plainly
#                indicates the modality, never as a general loosening)
#   max_minutes  ceiling applied on top of the readiness-class ceiling
#
# An unrecognised limitation falls through to MOBILITY_DEFAULT, which stays
# conservative: something is recorded, so impact comes off the table.
MOBILITY_RULES = [
    ("pool", {"drop": {"run"}, "add": {"swim"}}),
    ("swim", {"drop": {"run"}, "add": {"swim"}}),
    ("impact", {"drop": {"run"}}),
    ("short bout", {"drop": {"run"}, "max_minutes": 20}),
    ("rest break", {"drop": {"run"}, "max_minutes": 25}),
    ("range of motion", {"drop": {"run"}}),
    ("hill", {"drop": {"run"}}),
    ("incline", {"drop": {"run"}}),
]
MOBILITY_DEFAULT = {"drop": IMPACT_ACTIVITIES}


def mobility_rule(value):
    """The constraint a recorded mobility limitation implies, or None."""
    if not _flag_set(value):
        return None
    text = str(value).strip().casefold()
    for needle, rule in MOBILITY_RULES:
        if needle in text:
            return rule
    return MOBILITY_DEFAULT

# Text that appears in the schema's flag fields and means "no flag set".
_FALSEY_TEXT = {"", "none", "no", "false", "n/a", "nil", "null"}

PHASES = ("warmup", "main", "cooldown")

MAX_BLOCKS = 6
MAX_CUE_CHARS = 140
MAX_FOCUS_CHARS = 80
MAX_NOTE_CHARS = 300
MAX_STOP_RULES = 5
MAX_STOP_RULE_CHARS = 120
WEEK_DAYS = 7

# Absolute ceiling on any single session, whatever the class or progression.
ABSOLUTE_MAX_MINUTES = 45


# ---------------------------------------------------------------------------
# Coercion helpers — DynamoDB hands back Decimal, and the LLM hands back
# whatever it feels like.
# ---------------------------------------------------------------------------

def _num(value):
    """Best-effort numeric coercion. Returns None rather than raising."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _text(value, limit):
    if value is None:
        return None
    cleaned = " ".join(str(value).split())
    return cleaned[:limit] if cleaned else None


def _flag_set(value):
    """True when a schema flag field actually carries a flag.

    `contraindicationFlag` and `mobilityLimitation` arrive as booleans in some
    records and as descriptive text ("none", "left knee") in others.
    """
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    return str(value).strip().casefold() not in _FALSEY_TEXT


def _normalise_activity(value):
    """Map a workout type onto the plan vocabulary, or None if unrecognised."""
    text = str(value or "").strip().casefold()
    aliases = {
        "walking": "walk", "walk": "walk",
        "running": "run", "run": "run", "jogging": "run",
        "swimming": "swim", "swim": "swim",
        "cycling": "cycle", "cycle": "cycle", "biking": "cycle",
        "mobility": "mobility", "stretching": "mobility", "yoga": "mobility",
        "breathing": "breathing",
        "rest": "rest",
    }
    return aliases.get(text)


def _cap_intensity(value, ceiling):
    """Clamp an intensity name to a ceiling. Unknown names clamp to the floor."""
    rank = min(INTENSITY_ORDER.get(value, 0), INTENSITY_ORDER.get(ceiling, 0))
    for name, order in INTENSITY_ORDER.items():
        if order == rank:
            return name
    return "none"


# ---------------------------------------------------------------------------
# Reading the member's real history
# ---------------------------------------------------------------------------

def last_completed_activity(history):
    """The newest completed ACTIVITY# item, read with both field spellings.

    `_plan_activity()` in the inference script takes "current session" to mean
    the newest *date*, so a check-in with no workout nulls out the activity and
    duration and it silently defaults to walk/20 (SYSTEM_CONTEXT section 7).
    The Lambda has the full history, so the envelope is anchored to the last
    session the member actually completed instead.

    `history` is the newest-first list the Lambda already loads.
    """
    for item in history or []:
        if not str(item.get("sk", "")).startswith("ACTIVITY#"):
            continue

        # Seeded items carry workoutStatus text; app-written items carry a
        # `completed` boolean. Either may be absent.
        status = item.get("workoutStatus")
        if status is not None and str(status).strip().casefold() not in ("completed", ""):
            continue
        if item.get("completed") is False:
            continue

        activity = _normalise_activity(item.get("workoutType") or item.get("activityType"))
        duration = _num(item.get("durationMin") or item.get("durationMinutes"))
        if activity is None and duration is None:
            continue
        return {
            "activity": activity,
            "duration_minutes": int(round(duration)) if duration else None,
            "date": str(item.get("sk", ""))[len("ACTIVITY#"):][:10],
        }
    return {}


def _latest_checkin(history):
    for item in history or []:
        if str(item.get("sk", "")).startswith("CHECKIN#"):
            return item
    return {}


# ---------------------------------------------------------------------------
# The envelope
# ---------------------------------------------------------------------------

def plan_envelope(prediction, member=None, history=None):
    """What the member is permitted to do, derived from model output only.

    Returns a dict that is both fed to the LLM as a constraint and used by
    `validate_plan()` as the acceptance test. Nothing the member wrote and
    nothing the LLM returns can influence it.
    """
    member = member or {}
    context = member.get("recoveryContext") or {}
    readiness = str(prediction.get("readiness") or "MAINTAIN").strip().upper()
    if readiness not in ("REDUCE", "MAINTAIN", "PROGRESS"):
        readiness = "MAINTAIN"

    last = last_completed_activity(history)
    last_activity = last.get("activity") or "walk"
    last_duration = last.get("duration_minutes") or 20
    preferred = _normalise_activity(member.get("activityPreference")) or last_activity

    checkin = _latest_checkin(history)
    pain = _num(checkin.get("pain"))

    contraindicated = _flag_set(context.get("contraindicationFlag"))
    # The seeded schema stores this as "Yes"/"No" text, not a boolean, so both
    # forms have to be recognised — reading only the boolean silently left
    # every uncleared member unrestricted. Absent still means "not recorded"
    # and must not force a restriction, so None is deliberately not falsey
    # here.
    cleared = context.get("clinicianCleared")
    not_cleared = cleared is False or (
        cleared is not None and str(cleared).strip().casefold() in ("false", "no", "0")
    )

    rest_today = False
    if contraindicated:
        # A contraindication is not a "today" signal — nothing is sanctioned
        # this week until it is lifted.
        rest_today = True
        allowed = set()
        max_total, week_base, max_intensity, max_rpe = 0, 0, "none", 0
    elif readiness == "REDUCE":
        reduce_ceiling = max(10, int(round(last_duration * 0.6)))
        if pain is not None and pain >= 7:
            # Rest is today's decision, driven by today's pain score. The rest
            # of the week is a provisional return at the REDUCE ceiling, not
            # seven days of rest — the model never said that either, and it is
            # rewritten at the next check-in.
            rest_today = True
            allowed = {"walk", "mobility", "breathing"}
            max_total, week_base = 0, reduce_ceiling
            max_intensity, max_rpe = "very_low", 3
        else:
            allowed = {"walk", "mobility", "breathing"}
            max_total = week_base = reduce_ceiling
            max_intensity, max_rpe = "very_low", 3
    elif readiness == "PROGRESS":
        allowed = {preferred, "walk", "mobility", "cycle", "swim"}
        max_total = week_base = min(ABSOLUTE_MAX_MINUTES, last_duration + 5)
        max_intensity, max_rpe = "moderate", 7
    else:
        allowed = {last_activity, "walk", "mobility"}
        max_total = week_base = min(30, last_duration)
        max_intensity, max_rpe = "low", 5

    # ---- overrides applied regardless of readiness class ----
    limitation = context.get("mobilityLimitation")
    rule = mobility_rule(limitation)
    if rule:
        allowed -= rule.get("drop", set())
        # Only ever added where the limitation names the modality, e.g.
        # "Pool-based preferred" plainly indicates swimming is available even
        # if the member's last session was something else.
        allowed |= rule.get("add", set())
    # A duration limitation is a hard ceiling for the whole week, not just for
    # today. Applied only to the base it would otherwise leave the progression
    # taper free to climb back past it by day six.
    mobility_cap = (rule or {}).get("max_minutes")
    if mobility_cap is not None:
        max_total = min(max_total, mobility_cap)
        week_base = min(week_base, mobility_cap)
    if str(context.get("vo2RiskBand") or "").strip().casefold() in ("high", "very_high"):
        max_intensity = _cap_intensity(max_intensity, "low")
    if not_cleared:
        max_intensity = _cap_intensity(max_intensity, "very_low")
        max_total = min(max_total, 20)
        week_base = min(week_base, 20)
        max_rpe = min(max_rpe, 3)

    allowed &= KNOWN_ACTIVITIES
    allowed.discard("rest")

    progression_allowed = (
        readiness == "PROGRESS"
        and not not_cleared
        and not contraindicated
        and str(prediction.get("recovery_trend") or "").strip().casefold() == "improving"
    )

    return {
        "readiness": readiness,
        "is_rest_day": rest_today,
        "allowed_activities": sorted(allowed),
        "max_total_minutes": int(max_total),
        "max_intensity": max_intensity,
        "max_rpe": int(max_rpe),
        "progression_allowed": progression_allowed,
        # Carried so the app can show *why* an activity is unavailable rather
        # than only that it is, and so the LLM can write cues that respect it.
        "mobility_limitation": _text(limitation, 60) if rule else None,
        "week_day_max_minutes": [
            min(c, mobility_cap) if mobility_cap is not None else c
            for c in _week_ceilings(rest_today, max_total, week_base, progression_allowed)
        ],
        "anchor": {
            "last_completed_activity": last_activity,
            "last_completed_minutes": last_duration,
            "last_completed_date": last.get("date"),
            "reported_pain": pain,
        },
        "notes": (
            "Day 1 is bound by the model's readiness class for the next session. "
            "Days 2-7 are provisional and are regenerated at every check-in."
        ),
    }


def _week_ceilings(rest_today, max_total, week_base, progression_allowed):
    """Per-day minute ceilings for the provisional week.

    `max_total` binds today; `week_base` binds days 2-7. They differ only on a
    rest day, where today is zero but the week may plan a gentle return — and
    a contraindication zeroes both, so the whole week stays at rest.
    """
    base = int(week_base)
    ceilings = [0 if rest_today else int(max_total)]
    for day in range(1, WEEK_DAYS):
        if progression_allowed:
            ceilings.append(min(ABSOLUTE_MAX_MINUTES, base + 5 * day))
        else:
            ceilings.append(base)
    return ceilings


# ---------------------------------------------------------------------------
# Validation — the replacement safety guarantee
# ---------------------------------------------------------------------------

class PlanRejected(Exception):
    """A plan stepped outside the envelope and must not be rendered."""


def validate_plan(raw, envelope):
    """Check an LLM-authored plan against the envelope.

    Returns `(plan, None)` when the plan is acceptable, or `(None, reason)`
    when it is not. Never raises, never repairs: a plan that violates any
    constraint is discarded whole, because a partially-corrected plan is not
    something the model ever sanctioned.
    """
    try:
        if not isinstance(raw, dict):
            raise PlanRejected("plan_not_an_object")
        session = _validate_session(raw.get("exercise_plan"), envelope)
        week = _validate_week(raw.get("week_plan"), envelope)
        return {"exercise_plan": session, "week_plan": week}, None
    except PlanRejected as exc:
        return None, str(exc)
    except Exception as exc:  # malformed types, unexpected shapes
        return None, f"plan_malformed:{type(exc).__name__}"


def _validate_block(block, envelope, index):
    if not isinstance(block, dict):
        raise PlanRejected(f"block_{index}_not_an_object")

    phase = str(block.get("phase") or "").strip().casefold()
    if phase not in PHASES:
        raise PlanRejected(f"block_{index}_bad_phase:{phase or 'missing'}")

    activity = _normalise_activity(block.get("activity"))
    if activity is None:
        raise PlanRejected(f"block_{index}_unknown_activity:{block.get('activity')!r}")

    if envelope["is_rest_day"] and activity != "rest":
        raise PlanRejected(f"block_{index}_activity_on_rest_day:{activity}")
    if activity != "rest" and activity not in envelope["allowed_activities"]:
        raise PlanRejected(f"block_{index}_activity_not_allowed:{activity}")

    minutes = _num(block.get("minutes"))
    if minutes is None or minutes < 0:
        raise PlanRejected(f"block_{index}_bad_minutes:{block.get('minutes')!r}")
    minutes = int(round(minutes))
    if minutes > envelope["max_total_minutes"]:
        raise PlanRejected(
            f"block_{index}_minutes_exceed_envelope:{minutes}>{envelope['max_total_minutes']}"
        )

    intensity = str(block.get("intensity") or "").strip().casefold()
    if intensity not in INTENSITY_ORDER:
        raise PlanRejected(f"block_{index}_unknown_intensity:{intensity or 'missing'}")
    if INTENSITY_ORDER[intensity] > INTENSITY_ORDER[envelope["max_intensity"]]:
        raise PlanRejected(
            f"block_{index}_intensity_exceeds_envelope:{intensity}>{envelope['max_intensity']}"
        )

    rpe = _num(block.get("target_rpe"))
    if rpe is not None:
        rpe = int(round(rpe))
        if rpe > envelope["max_rpe"]:
            raise PlanRejected(f"block_{index}_rpe_exceeds_envelope:{rpe}>{envelope['max_rpe']}")

    return {
        "phase": phase,
        "activity": activity,
        "minutes": minutes,
        "intensity": intensity,
        "target_rpe": rpe,
        "cue": _text(block.get("cue"), MAX_CUE_CHARS),
    }


def _validate_session(session, envelope):
    if not isinstance(session, dict):
        raise PlanRejected("exercise_plan_missing")

    blocks = session.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        raise PlanRejected("no_blocks")
    if len(blocks) > MAX_BLOCKS:
        raise PlanRejected(f"too_many_blocks:{len(blocks)}")

    validated = [_validate_block(b, envelope, i) for i, b in enumerate(blocks)]

    total = sum(b["minutes"] for b in validated)
    if total > envelope["max_total_minutes"]:
        raise PlanRejected(f"total_minutes_exceed_envelope:{total}>{envelope['max_total_minutes']}")

    if not any(b["phase"] == "main" for b in validated):
        raise PlanRejected("no_main_block")

    stop_rules = session.get("stop_rules")
    stop_rules = stop_rules if isinstance(stop_rules, list) else []
    stop_rules = [_text(r, MAX_STOP_RULE_CHARS) for r in stop_rules[:MAX_STOP_RULES]]

    return {
        "session_focus": _text(session.get("session_focus"), MAX_FOCUS_CHARS),
        "blocks": validated,
        "total_minutes": total,
        "stop_rules": [r for r in stop_rules if r],
        "progression_note": _text(session.get("progression_note"), MAX_NOTE_CHARS),
    }


def _validate_week(week, envelope):
    if not isinstance(week, list):
        raise PlanRejected("week_plan_missing")
    if len(week) != WEEK_DAYS:
        raise PlanRejected(f"week_plan_wrong_length:{len(week)}")

    ceilings = envelope["week_day_max_minutes"]
    validated = []
    for index, entry in enumerate(week):
        if not isinstance(entry, dict):
            raise PlanRejected(f"week_day_{index + 1}_not_an_object")

        activity = _normalise_activity(entry.get("activity"))
        if activity is None:
            raise PlanRejected(f"week_day_{index + 1}_unknown_activity:{entry.get('activity')!r}")
        if activity != "rest" and activity not in envelope["allowed_activities"]:
            raise PlanRejected(f"week_day_{index + 1}_activity_not_allowed:{activity}")
        # Day 1 is today. A zero-minute walk is still not a rest day.
        if index == 0 and envelope["is_rest_day"] and activity != "rest":
            raise PlanRejected(f"week_day_1_activity_on_rest_day:{activity}")

        minutes = _num(entry.get("durationMinutes") or entry.get("minutes"))
        minutes = 0 if minutes is None else int(round(minutes))
        if minutes < 0 or minutes > ceilings[index]:
            raise PlanRejected(
                f"week_day_{index + 1}_minutes_exceed_envelope:{minutes}>{ceilings[index]}"
            )

        intensity = str(entry.get("intensity") or "none").strip().casefold()
        if intensity not in INTENSITY_ORDER:
            raise PlanRejected(f"week_day_{index + 1}_unknown_intensity:{intensity}")
        if INTENSITY_ORDER[intensity] > INTENSITY_ORDER[envelope["max_intensity"]]:
            raise PlanRejected(
                f"week_day_{index + 1}_intensity_exceeds_envelope:"
                f"{intensity}>{envelope['max_intensity']}"
            )
        if activity == "rest" and minutes != 0:
            raise PlanRejected(f"week_day_{index + 1}_rest_with_minutes:{minutes}")

        validated.append({
            "day": index + 1,
            "activity": activity,
            "durationMinutes": minutes,
            "intensity": intensity,
            "focus": _text(entry.get("focus"), MAX_FOCUS_CHARS),
            # Only day 1 is bound to the model's next-session prediction.
            "provisional": index > 0,
        })
    return validated


# ---------------------------------------------------------------------------
# Deterministic fallback
# ---------------------------------------------------------------------------

def rules_plan(envelope, prediction):
    """The plan rendered whenever LLM generation fails or is rejected.

    Built from the prediction's own `_plan_activity()` output so that with
    plan generation switched off the app shows exactly the numbers it shows
    today, then clamped to the envelope so this path cannot violate it either.
    """
    if envelope["is_rest_day"]:
        activity, minutes, intensity = "rest", 0, "none"
    else:
        activity = _normalise_activity(prediction.get("recommended_activity")) or "walk"
        if activity != "rest" and activity not in envelope["allowed_activities"]:
            activity = envelope["allowed_activities"][0] if envelope["allowed_activities"] else "rest"
        minutes = _num(prediction.get("duration_minutes"))
        minutes = int(round(minutes)) if minutes is not None else 0
        minutes = max(0, min(minutes, envelope["max_total_minutes"]))
        intensity = _cap_intensity(
            str(prediction.get("intensity") or "low").strip().casefold(),
            envelope["max_intensity"],
        )
        if activity == "rest":
            minutes, intensity = 0, "none"

    session = {
        "session_focus": "Recovery day" if activity == "rest" else "Steady recovery session",
        "blocks": [{
            "phase": "main",
            "activity": activity,
            "minutes": minutes,
            "intensity": intensity,
            "target_rpe": None,
            "cue": None,
        }],
        "total_minutes": minutes,
        "stop_rules": [
            "Stop if pain increases beyond your usual level.",
            "Stop if you feel dizzy, breathless at rest, or unwell.",
        ],
        "progression_note": None,
    }

    ceilings = envelope["week_day_max_minutes"]
    week = []
    for index in range(WEEK_DAYS):
        day_minutes = min(minutes, ceilings[index])
        day_activity = activity if day_minutes > 0 else "rest"
        week.append({
            "day": index + 1,
            "activity": day_activity,
            "durationMinutes": day_minutes if day_activity != "rest" else 0,
            "intensity": intensity if day_activity != "rest" else "none",
            "focus": None,
            "provisional": index > 0,
        })

    return {"exercise_plan": session, "week_plan": week}


def derive_headline(session):
    """Headline plan fields, derived from the validated session.

    Keeps the hero card and the block detail from ever disagreeing: both come
    from the same validated structure, which is itself inside the envelope.
    """
    blocks = (session or {}).get("blocks") or []
    if not blocks:
        return "rest", 0, "none"

    working = [b for b in blocks if b.get("activity") != "rest"]
    if not working:
        return "rest", 0, "none"

    main = next((b for b in working if b.get("phase") == "main"), working[0])
    total = sum(int(b.get("minutes") or 0) for b in blocks)
    peak = max(working, key=lambda b: INTENSITY_ORDER.get(b.get("intensity"), 0))
    return main.get("activity") or "walk", total, peak.get("intensity") or "low"
