import json
import os
import time
import traceback
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key

import exercise_plan
import llm_client
import prompt_orchestrator
import what_if


def _json_default(o):
    if isinstance(o, Decimal):
        return float(o) if o % 1 else int(o)
    raise TypeError(f"Not JSON serializable: {type(o)}")


def _to_dynamo(v):
    """DynamoDB rejects Python floats — convert them (recursively) to Decimal."""
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, list):
        return [_to_dynamo(x) for x in v]
    if isinstance(v, dict):
        return {k: _to_dynamo(x) for k, x in v.items()}
    return v


def _latest_item(member_id, type_prefix):
    """Newest item of a given type for a member, or None."""
    resp = timeseries_table.query(
        KeyConditionExpression=Key("memberId").eq(member_id)
        & Key("sk").begins_with(f"{type_prefix}#"),
        ScanIndexForward=False,   # descending: newest first
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def handle_dashboard(event):
    params = event.get("queryStringParameters") or {}
    member_id = params.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId query parameter is required"})

    member_resp = members_table.get_item(Key={"memberId": member_id})
    member = member_resp.get("Item")
    if not member:
        return _response(404, {"error": "member_not_found", "memberId": member_id})

    latest_checkin = _latest_item(member_id, "CHECKIN")
    latest_prediction = _latest_item(member_id, "PREDICTION")
    # Stored prediction if one exists; otherwise infer now (mock until
    # SAGEMAKER_ENDPOINT is configured)
    prediction = latest_prediction or get_prediction(member_id)

    # Newest wearable readings (sleep, HR, VO2) so the app can show real data
    readings = timeseries_table.query(
        KeyConditionExpression=Key("memberId").eq(member_id)
        & Key("sk").begins_with("READING#"),
        ScanIndexForward=False,
        Limit=7,
    ).get("Items", [])

    # Newest workouts for the strain view
    activities = timeseries_table.query(
        KeyConditionExpression=Key("memberId").eq(member_id)
        & Key("sk").begins_with("ACTIVITY#"),
        ScanIndexForward=False,
        Limit=7,
    ).get("Items", [])

    # Oldest reading = the member's VO2 baseline point
    oldest = timeseries_table.query(
        KeyConditionExpression=Key("memberId").eq(member_id)
        & Key("sk").begins_with("READING#"),
        ScanIndexForward=True,
        Limit=1,
    ).get("Items", [])

    todays_plan, week_plan = _plan_payload(prediction)

    return _response(200, {
        "member": member,
        "latestCheckin": latest_checkin,
        "recentReadings": readings,
        "recentActivities": activities,
        "oldestReading": oldest[0] if oldest else None,
        "prediction": prediction,
        "todaysPlan": todays_plan,
        "weekPlan": week_plan,
        # Structured session detail. Absent on predictions written before the
        # plan layer, and whenever PLAN_PROVIDER is 'rules'.
        "exercisePlan": prediction.get("exercise_plan"),
        "planSource": prediction.get("plan_source"),
        # Coach text is generated alongside the prediction and stored with it,
        # so a dashboard load never calls the LLM. Falls back to the static
        # message for predictions written before the coach layer existed.
        "coach": prediction.get("coach") or COACH_MESSAGE,
    })


# ---- Contract JSON (from implementation plan, section 10) ----

MODEL_PREDICTION = {
    "recovery_score": 72.4,
    "readiness_score": 68.0,
    "recovery_stage": 2,
    "recovery_trend": "improving",
    "setback_probability": 0.19,
    "recommended_activity": "walk",
    "duration_minutes": 20,
    "intensity": "low",
    "predicted_days_to_milestone": 12,
    "confidence": 0.87,
    "top_factors": [
        {"feature": "resting_hr_deviation", "direction": "positive"},
        {"feature": "sleep_trend", "direction": "positive"},
        {"feature": "fatigue", "direction": "negative"},
    ],
    "model_version": "recovery-mtl-0.1.0",
}

COACH_MESSAGE = {
    "summary": "Your recovery is moving in the right direction.",
    "explanation": "Your resting heart rate and sleep are closer to baseline, although fatigue remains elevated.",
    "coaching_message": "Complete a 20-minute low-intensity walk and stop if your symptoms worsen.",
    "follow_up_question": "How did your fatigue change after your last walk?",
}

DEMO_MEMBER = {
    "memberId": "ENT000001",
    "firstName": "Fatima",
    "surname": "Meyer",
    "province": "Northern Cape",
    "medicalAidPlan": "Classic Delta Core",
    "vitalityStatus": "Silver",
    "activityBaseline": "Post-intervention restart",
    "recoveryGoal": "Improve sleep and energy",
    "recoveryContext": {
        "conditionCategory": "post_flu_inactivity",
        "daysSinceEvent": 14,
        "recoveryStage": 2,
    },
    "vo2max": {"baseline": 24.1, "current": 25.3},
}

DASHBOARD = {
    "member": DEMO_MEMBER,
    "prediction": MODEL_PREDICTION,
    "todaysPlan": {
        "activity": "walk",
        "durationMinutes": 20,
        "intensity": "low",
        "completed": False,
    },
    "weekPlan": [
        {"day": 1, "activity": "walk", "durationMinutes": 15, "intensity": "very_low"},
        {"day": 2, "activity": "rest", "durationMinutes": 0, "intensity": "none"},
        {"day": 3, "activity": "walk", "durationMinutes": 20, "intensity": "low"},
        {"day": 4, "activity": "walk", "durationMinutes": 20, "intensity": "low"},
        {"day": 5, "activity": "rest", "durationMinutes": 0, "intensity": "none"},
        {"day": 6, "activity": "walk", "durationMinutes": 25, "intensity": "low"},
        {"day": 7, "activity": "swim", "durationMinutes": 15, "intensity": "low"},
    ],
    "coach": COACH_MESSAGE,
}

def _plan_payload(prediction):
    """(todaysPlan, weekPlan) for the dashboard.

    Real once a prediction carries a generated plan; otherwise the original
    static demo plan, so predictions stored before the plan layer — and the
    whole PLAN_PROVIDER='rules' path — keep working unchanged.
    """
    if not prediction.get("exercise_plan"):
        return DASHBOARD["todaysPlan"], DASHBOARD["weekPlan"]

    activity = prediction.get("recommended_activity") or "rest"
    return (
        {
            "activity": activity,
            "durationMinutes": prediction.get("duration_minutes") or 0,
            "intensity": prediction.get("intensity") or "none",
            "completed": False,
        },
        prediction.get("week_plan") or DASHBOARD["weekPlan"],
    )


SIMULATION_RESULT = {
    "proposed": {"activity": "run", "distanceKm": 5, "intensity": "moderate"},
    "recommended": MODEL_PREDICTION,
    "comparison": {
        "setback_probability_proposed": 0.44,
        "setback_probability_recommended": 0.19,
        "verdict": "not_advised",
        "saferAlternative": {"activity": "walk", "durationMinutes": 25, "intensity": "low"},
    },
}

# ---- Routing table: (METHOD, path) -> (status, body) ----

dynamodb = boto3.resource("dynamodb")
members_table = dynamodb.Table(os.environ["MEMBERS_TABLE"])
timeseries_table = dynamodb.Table(os.environ["TIMESERIES_TABLE"])

# Member 4's SageMaker endpoint; empty = mock mode (see get_prediction).
# The models are hosted in eu-west-1 while this stack runs in eu-central-1,
# so the runtime client takes an explicit region.
SAGEMAKER_ENDPOINT = os.environ.get("SAGEMAKER_ENDPOINT", "")
SAGEMAKER_REGION = os.environ.get("SAGEMAKER_REGION") or None
sagemaker_runtime = boto3.client("sagemaker-runtime", region_name=SAGEMAKER_REGION)

# Who authors the exercise plan: 'rules' keeps the deterministic
# _plan_activity() output the app has always shown, 'gemini' lets the LLM
# design a session inside the model-derived envelope (see exercise_plan.py).
# Defaults to 'rules' so deploying this code changes nothing until it is
# switched on deliberately.
PLAN_PROVIDER = os.environ.get("PLAN_PROVIDER", "rules").strip().lower()

# Master switch for regenerating the AI session on a check-in. The caller still
# has to ask for it per request (refreshPlan), so this only ever takes the
# option away - useful if LLM quota tightens again, without a redeploy.
LLM_ON_CHECKIN = os.environ.get("LLM_ON_CHECKIN", "true").strip().lower() == "true"


HISTORY_TYPES = ("ACTIVITY", "READING", "CHECKIN")


def _recent_history(member_id, per_type=25):
    """Newest raw timeseries items (activities, readings, check-ins) for a member.

    Queried per type rather than as one descending scan with a limit. The sort
    key is TYPE#ISO8601, so a single query orders by *type* before date -
    READING, then PREDICTION, then CHECKIN, then ACTIVITY - and the limit cuts
    from the bottom. A member with enough readings, predictions and check-ins
    to fill it lost every ACTIVITY item, so the model saw no workouts at all:
    duration, exertion, completion rate and cumulative load were imputed, and
    the plan envelope fell back to its default anchor.

    It also degraded over time. PREDICTION# items are excluded here, but under
    the old query they were fetched first and filtered afterwards, so every
    check-in wrote another prediction that consumed part of the budget and
    pushed real history further out of reach.

    Predictions are never included: the model must not be fed its own output.
    """
    items = []
    for prefix in HISTORY_TYPES:
        resp = timeseries_table.query(
            KeyConditionExpression=Key("memberId").eq(member_id)
            & Key("sk").begins_with(f"{prefix}#"),
            ScanIndexForward=False,   # newest first within each type
            Limit=per_type,
        )
        items.extend(resp.get("Items", []))
    return items


def _latest_checkin_for_prompt(history):
    """Newest CHECKIN# item out of the already-loaded history, or None."""
    for item in history or []:
        if str(item.get("sk", "")).startswith("CHECKIN#"):
            return item
    return None


def _generate_coach(member, prediction, history, question=None, envelope=None):
    """Build the APO prompt and generate the coaching prose.

    Returns (coach_prose, raw_plan, source) where source is "gemini" or
    "fallback". `raw_plan` is None unless an envelope was supplied, and is
    unvalidated even then — it must go through exercise_plan.validate_plan()
    before anything renders it.
    """
    plan = prompt_orchestrator.authoritative_plan(prediction)
    prompt = prompt_orchestrator.build_coach_prompt(
        member=member,
        prediction=prediction,
        history=history,
        latest_checkin=_latest_checkin_for_prompt(history),
        question=question,
        envelope=envelope,
    )
    if envelope is None:
        coach, source = llm_client.generate_coach_message(prompt, plan)
        return coach, None, source
    return llm_client.generate_coach_message_with_plan(prompt, plan)


def _attach_exercise_plan(prediction, envelope, raw_plan, generated_at, llm_requested):
    """Validate the LLM's plan against the envelope and attach the result.

    Takes the same envelope object that was sent to the LLM, so the constraints
    the plan was checked against are provably the ones it was given.

    Always attaches a plan. `plan_source` distinguishes the three ways that can
    happen, because "we did not ask the LLM" and "the LLM's plan failed the
    safety check" look identical on screen otherwise:

      gemini        - the LLM's plan passed validation
      rules         - the LLM was asked and its plan was rejected
      not_requested - no LLM call was made; deterministic plan, no cost
    """
    if raw_plan:
        validated, reason = exercise_plan.validate_plan(raw_plan, envelope)
    else:
        validated, reason = None, "no_plan_returned" if llm_requested else None

    if validated:
        plan_source = "gemini"
    else:
        validated = exercise_plan.rules_plan(envelope, prediction)
        plan_source = "rules" if llm_requested else "not_requested"
        if reason:
            prediction["plan_rejection_reason"] = reason
            print(json.dumps({
                "level": "WARN",
                "message": "exercise_plan_rejected",
                "reason": reason,
                "readiness": envelope.get("readiness"),
            }))

    prediction["exercise_plan"] = validated["exercise_plan"]
    prediction["week_plan"] = validated["week_plan"]
    prediction["plan_envelope"] = envelope
    prediction["plan_source"] = plan_source
    prediction["plan_prompt_version"] = prompt_orchestrator.PLAN_PROMPT_VERSION
    prediction["plan_generated_at"] = generated_at

    activity, minutes, intensity = exercise_plan.derive_headline(validated["exercise_plan"])
    prediction["recommended_activity"] = activity
    prediction["duration_minutes"] = minutes
    prediction["intensity"] = intensity

    # Day 1 of the week *is* today's session, so it is overwritten rather than
    # taken from the LLM. Left alone the two disagree in a way that reads as a
    # bug on screen: the model returned a 20-minute main block inside a
    # 30-minute session, so the hero card said 30 min and day 1 said 20.
    if validated["week_plan"]:
        validated["week_plan"][0] = {
            **validated["week_plan"][0],
            "activity": activity,
            "durationMinutes": minutes,
            "intensity": intensity,
            "provisional": False,
        }
    return prediction


def get_prediction(member_id, question=None, use_llm=False):
    """Readiness/VO2 prediction for a member (contract: plan section 10.1).

    When SAGEMAKER_ENDPOINT is set, synchronously invokes Member 4's endpoint
    with the member profile + raw recent history (the inference script computes
    the engineered features so they match training), persists the result as a
    PREDICTION# item, and returns it. When unset — or on any failure — returns
    the static mock so the app always receives a valid prediction.

    `use_llm` defaults to False so that no code path spends an LLM request by
    accident. Dashboard loads and check-ins run the models and build the
    deterministic plan for free; only POST /plan, which exists solely to be
    called by the app's Generate button, passes True.
    """
    if not SAGEMAKER_ENDPOINT:
        return MODEL_PREDICTION
    try:
        member = members_table.get_item(Key={"memberId": member_id}).get("Item") or {}
        history = _recent_history(member_id)
        payload = json.dumps({
            "memberId": member_id,
            "member": member,
            "history": history,
        }, default=_json_default)
        resp = sagemaker_runtime.invoke_endpoint(
            EndpointName=SAGEMAKER_ENDPOINT,
            ContentType="application/json",
            Accept="application/json",
            Body=payload,
        )
        prediction = json.loads(resp["Body"].read())
        ts = _now_iso()

        # The envelope is always computed: it is pure arithmetic over the
        # model's own output and costs nothing, and it is what lets a member
        # who has never pressed Generate still see a real structured session.
        envelope = exercise_plan.plan_envelope(prediction, member, history)
        want_llm_plan = use_llm and PLAN_PROVIDER == "gemini"

        if use_llm:
            # The coach layer explains the prediction; it never changes the
            # readiness decision, and it can never fail the request
            # (generation never raises).
            coach, raw_plan, coach_source = _generate_coach(
                member, prediction, history, question,
                envelope=envelope if want_llm_plan else None)
        else:
            # No LLM call at all. Inference still runs, the plan is still
            # built — deterministically — so a check-in reacts to new data
            # without spending a request. Only an explicit /plan does that.
            coach = llm_client.fallback_coach_response(
                prompt_orchestrator.authoritative_plan(prediction))
            raw_plan, coach_source = None, "not_requested"

        prediction["coach"] = coach
        # What actually wrote the text, not what was configured.
        prediction["coach_source"] = coach_source
        prediction["coach_provider"] = os.environ.get("LLM_PROVIDER", "mock")
        prediction["coach_prompt_version"] = (
            prompt_orchestrator.PLAN_PROMPT_VERSION if want_llm_plan
            else prompt_orchestrator.PROMPT_VERSION
        )

        prediction = _attach_exercise_plan(
            prediction, envelope, raw_plan, ts, llm_requested=want_llm_plan)

        timeseries_table.put_item(Item=_to_dynamo({
            "memberId": member_id,
            "sk": f"PREDICTION#{ts}",
            "type": "PREDICTION",
            "createdAt": ts,
            **prediction,
        }))
        return prediction
    except Exception:
        print(json.dumps({
            "level": "ERROR",
            "message": "sagemaker_inference_failed",
            "memberId": member_id,
            "endpoint": SAGEMAKER_ENDPOINT,
            "traceback": traceback.format_exc(),
        }))
        return MODEL_PREDICTION


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body, default=_json_default),
    }


def _parse_body(event):
    try:
        return json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return None


# ---- Real handlers ----

def handle_onboarding(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    item = {
        "memberId": member_id,
        "firstName": body.get("firstName", ""),
        "surname": body.get("surname", ""),
        "recoveryContext": body.get("recoveryContext", {}),
        "goals": body.get("goals", []),
        "activityPreference": body.get("activityPreference", "walk"),
        "createdAt": _now_iso(),
    }
    members_table.put_item(Item=_to_dynamo(item))
    return _response(201, {"memberId": member_id, "status": "created"})


def handle_checkin(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    # Optional explicit timestamp, mirroring /wearables/simulate. The demo
    # simulator advances dates to build a trend, and inference.py keys
    # sessions by date — without this the check-in lands on today while the
    # simulated readings sit in the future, so its pain/fatigue never reach
    # the newest session and the model appears not to react.
    ts = body.get("timestamp") or _now_iso()
    item = {
        "memberId": member_id,
        "sk": f"CHECKIN#{ts}",
        "type": "CHECKIN",
        "pain": body.get("pain"),
        "fatigue": body.get("fatigue"),
        "symptoms": body.get("symptoms", []),
        "confidence": body.get("confidence"),
        "mood": body.get("mood"),
        "createdAt": ts,
    }
    timeseries_table.put_item(Item=_to_dynamo(item))

    # Fresh inference after new data (mock until SAGEMAKER_ENDPOINT is
    # configured). Both models always re-run; the AI session is only
    # regenerated when the caller asks.
    #
    # The daily check-in asks, because that is the member deliberately telling
    # the system how they feel and the moment the session should change. The
    # wearable simulator does not: a demo run is many check-ins in a row, and
    # each would spend a request and add several seconds per step for a
    # session nobody reads between steps. The simulator still shows the models
    # reacting - readiness, setback risk and the deterministic plan all move.
    refresh_plan = bool(body.get("refreshPlan")) and LLM_ON_CHECKIN
    prediction = get_prediction(member_id, use_llm=refresh_plan)
    return _response(201, {
        "status": "recorded",
        "checkinSk": item["sk"],
        "prediction": prediction,
        "coach": prediction.get("coach") or COACH_MESSAGE,
    })


def handle_activity(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    # Optional explicit timestamp, mirroring /checkins and /wearables/simulate.
    # inference.py keys sessions by date, so a simulated workout must be able to
    # land on the same simulated day as the reading and check-in it belongs
    # with; defaulted to now it would form a separate session on today's date
    # and its duration and RPE would never reach the same feature row.
    ts = body.get("timestamp") or _now_iso()
    duration = body.get("durationMinutes", body.get("durationMin"))
    distance = body.get("distanceKm", body.get("distance"))
    avg_heart_rate = body.get("avgHeartRate", body.get("avgHr"))
    max_heart_rate = body.get("maxHeartRate", body.get("maxHr"))
    workout_type = body.get("workoutType", body.get("activityType"))
    item = {
        "memberId": member_id,
        "sk": f"ACTIVITY#{ts}",
        "type": "ACTIVITY",
        "activityType": body.get("activityType"),      # walk | run | swim
        "workoutType": workout_type,
        "durationMin": duration,
        "durationMinutes": duration,
        "distanceKm": distance,
        "distance": distance,
        "avgHeartRate": avg_heart_rate,
        "maxHeartRate": max_heart_rate,
        "caloriesBurned": body.get("caloriesBurned"),
        "intensity": body.get("intensity"),             # very_low | low | moderate
        "perceivedExertion": body.get("perceivedExertion"),  # e.g. 1-10 (RPE)
        "rpe": body.get("rpe", body.get("perceivedExertion")),
        "completed": body.get("completed", True),
        "createdAt": ts,
    }
    timeseries_table.put_item(Item=_to_dynamo(item))

    prediction = get_prediction(member_id)
    return _response(201, {
        "status": "recorded",
        "activitySk": item["sk"],
        "prediction": prediction,
        "coach": prediction.get("coach") or COACH_MESSAGE,
    })


def handle_wearable_simulate(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    # Accept either a single reading or a list under "readings"
    readings = body.get("readings")
    if readings is None:
        readings = [body]  # treat the whole body as one reading

    written = []
    with timeseries_table.batch_writer() as batch:
        for r in readings:
            # Allow an explicit timestamp so the demo can back-date readings;
            # default to now.
            ts = r.get("timestamp") or _now_iso()
            item = {
                "memberId": member_id,
                "sk": f"READING#{ts}",
                "type": "READING",
                "restingHr": r.get("restingHr"),
                "hrBaseline": r.get("hrBaseline"),
                "vo2max": r.get("vo2max"),
                "sleepHours": r.get("sleepHours"),
                "steps": r.get("steps"),
                "activeMinutes": r.get("activeMinutes"),
                "createdAt": ts,
            }
            # Optional, and only written when supplied. Uses the same field
            # name the seed script and inference.py already read, so it feeds
            # HRV ms / average_hrv_last_3 / hrv_trend_last_3 with no other
            # changes. Callers that omit it are unaffected.
            if r.get("hrvMs") is not None:
                item["hrvMs"] = r["hrvMs"]
            batch.put_item(Item=_to_dynamo(item))
            written.append(item["sk"])

    return _response(201, {"status": "inserted", "count": len(written), "sks": written})


def handle_coach_message(event):
    """Answer a member's question, grounded in their stored prediction.

    The plan is never recomputed here and the LLM cannot change it — the
    member's question only steers the wording of the explanation.
    """
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    question = body.get("message") or body.get("question")

    member = members_table.get_item(Key={"memberId": member_id}).get("Item") or {}
    prediction = _latest_item(member_id, "PREDICTION")
    if not prediction:
        prediction = get_prediction(member_id, question=question)
        return _response(200, prediction.get("coach") or COACH_MESSAGE)

    history = _recent_history(member_id)
    # Prose only: a question never regenerates the plan, so the explain-only
    # contract (and its guarantee that the LLM cannot emit plan fields at all)
    # still applies on this path.
    coach, _, coach_source = _generate_coach(member, prediction, history, question)
    return _response(200, {**coach, "coach_source": coach_source})


def handle_generate_plan(event):
    """Generate a fresh prediction and exercise plan on demand.

    Deliberately separate from /checkins: regenerating a plan should not write
    a check-in the member never made. Costs exactly one LLM request — the
    prose and the plan come back from a single call — which is why the app
    puts this behind an explicit button instead of generating on page load.
    """
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    # The one call site in the whole backend that spends an LLM request.
    prediction = get_prediction(member_id, use_llm=True)
    return _response(201, {
        "status": "generated",
        "planSource": prediction.get("plan_source"),
        "coachSource": prediction.get("coach_source"),
        "prediction": prediction,
        "coach": prediction.get("coach") or COACH_MESSAGE,
    })


def handle_simulation(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    # Judged against the same envelope that bounds the exercise plan, using
    # the member's real prediction. No LLM: a safety judgement should not
    # depend on generated text, and this endpoint therefore costs nothing.
    member = members_table.get_item(Key={"memberId": member_id}).get("Item") or {}
    history = _recent_history(member_id)
    prediction = _latest_item(member_id, "PREDICTION") or get_prediction(member_id)
    envelope = exercise_plan.plan_envelope(prediction, member, history)

    # Offer the plan the app is already showing, so the safer alternative here
    # is the real one rather than a second opinion invented on the spot.
    recommended = {
        "activity": prediction.get("recommended_activity"),
        "durationMinutes": prediction.get("duration_minutes"),
        "intensity": prediction.get("intensity"),
    }

    return _response(200, what_if.evaluate(
        question=body.get("question"),
        override=body.get("proposed"),
        prediction=prediction,
        envelope=envelope,
        recommended=recommended,
    ))


# ---- Routing ----

MOCK_ROUTES = {
    ("POST", "/auth/demo"): (200, DEMO_MEMBER),
    ("POST", "/recovery/infer"): (200, MODEL_PREDICTION),
}

REAL_ROUTES = {
    ("POST", "/onboarding"): handle_onboarding,
    ("POST", "/checkins"): handle_checkin,
    ("POST", "/activities"): handle_activity,
    ("POST", "/wearables/simulate"): handle_wearable_simulate,
    ("POST", "/simulations"): handle_simulation,
    ("POST", "/plan"): handle_generate_plan,
    ("POST", "/coach/messages"): handle_coach_message,
    ("GET", "/dashboard"): handle_dashboard,
}


def _route(event, method, path):
    handler = REAL_ROUTES.get((method, path))
    if handler:
        return handler(event)

    route = MOCK_ROUTES.get((method, path))
    if route:
        status, body = route
        return _response(status, body)

    return _response(404, {"error": "not_found", "method": method, "path": path})


def lambda_handler(event, context):
    start = time.time()
    method = event.get("httpMethod", "")
    path = event.get("path", "")

    try:
        response = _route(event, method, path)
    except Exception:
        # Never leak a raw traceback to the app; log it, return a clean error
        print(json.dumps({
            "level": "ERROR",
            "message": "unhandled_exception",
            "method": method,
            "path": path,
            "traceback": traceback.format_exc(),
        }))
        response = _response(500, {"error": "internal_error"})

    print(json.dumps({
        "level": "INFO",
        "method": method,
        "path": path,
        "status": response["statusCode"],
        "durationMs": round((time.time() - start) * 1000, 1),
        "requestId": getattr(context, "aws_request_id", None),
    }))
    return response
