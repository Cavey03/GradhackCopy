import json
import os
import time
import traceback
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key


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

    return _response(200, {
        "member": member,
        "latestCheckin": latest_checkin,
        "recentReadings": readings,
        "recentActivities": activities,
        "oldestReading": oldest[0] if oldest else None,
        # Stored prediction if one exists; otherwise infer now (mock until
        # SAGEMAKER_ENDPOINT is configured)
        "prediction": latest_prediction or get_prediction(member_id),
        "todaysPlan": DASHBOARD["todaysPlan"],   # still mock; becomes real with the Plan entity
        "weekPlan": DASHBOARD["weekPlan"],
        "coach": DASHBOARD["coach"],
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


def _recent_history(member_id, limit=60):
    """Newest raw timeseries items (check-ins, activities, readings) for a member.
    Excludes PREDICTION# items — the model shouldn't be fed its own output."""
    resp = timeseries_table.query(
        KeyConditionExpression=Key("memberId").eq(member_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return [i for i in resp.get("Items", []) if not i["sk"].startswith("PREDICTION#")]


def get_prediction(member_id):
    """Readiness/VO2 prediction for a member (contract: plan section 10.1).

    When SAGEMAKER_ENDPOINT is set, synchronously invokes Member 4's endpoint
    with the member profile + raw recent history (the inference script computes
    the engineered features so they match training), persists the result as a
    PREDICTION# item, and returns it. When unset — or on any failure — returns
    the static mock so the app always receives a valid prediction.
    """
    if not SAGEMAKER_ENDPOINT:
        return MODEL_PREDICTION
    try:
        member = members_table.get_item(Key={"memberId": member_id}).get("Item") or {}
        payload = json.dumps({
            "memberId": member_id,
            "member": member,
            "history": _recent_history(member_id),
        }, default=_json_default)
        resp = sagemaker_runtime.invoke_endpoint(
            EndpointName=SAGEMAKER_ENDPOINT,
            ContentType="application/json",
            Accept="application/json",
            Body=payload,
        )
        prediction = json.loads(resp["Body"].read())
        ts = _now_iso()
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

    ts = _now_iso()
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

    # Fresh inference after new data (mock until SAGEMAKER_ENDPOINT is configured)
    return _response(201, {
        "status": "recorded",
        "checkinSk": item["sk"],
        "prediction": get_prediction(member_id),
    })


def handle_activity(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    ts = _now_iso()
    item = {
        "memberId": member_id,
        "sk": f"ACTIVITY#{ts}",
        "type": "ACTIVITY",
        "activityType": body.get("activityType"),      # walk | run | swim
        "durationMinutes": body.get("durationMinutes"),
        "intensity": body.get("intensity"),             # very_low | low | moderate
        "perceivedExertion": body.get("perceivedExertion"),  # e.g. 1-10 (RPE)
        "completed": body.get("completed", True),
        "createdAt": ts,
    }
    timeseries_table.put_item(Item=_to_dynamo(item))

    return _response(201, {
        "status": "recorded",
        "activitySk": item["sk"],
        "prediction": get_prediction(member_id),
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
            batch.put_item(Item=_to_dynamo(item))
            written.append(item["sk"])

    return _response(201, {"status": "inserted", "count": len(written), "sks": written})


def handle_simulation(event):
    body = _parse_body(event)
    if body is None:
        return _response(400, {"error": "invalid_json"})

    member_id = body.get("memberId")
    if not member_id:
        return _response(400, {"error": "memberId is required"})

    # Keyword heuristic stands in for the real model until Member 4's
    # pipeline lands; response shape matches plan section 10 contract.
    question = (body.get("question") or "").lower()
    proposed = body.get("proposed") or {}
    high_strain_words = (
        "run", "sprint", "race", "heavy", "squat", "hiit", "match",
        "game", "performance", "band", "gig", "push through",
    )
    risky = (
        any(w in question for w in high_strain_words)
        or proposed.get("intensity") in ("moderate", "high")
    )

    if risky:
        comparison = {
            "setback_probability_proposed": 0.44,
            "setback_probability_recommended": 0.19,
            "verdict": "not_advised",
            "saferAlternative": {"activity": "walk", "durationMinutes": 25, "intensity": "low"},
        }
    else:
        comparison = {
            "setback_probability_proposed": 0.21,
            "setback_probability_recommended": 0.19,
            "verdict": "advised",
            "saferAlternative": {"activity": "walk", "durationMinutes": 20, "intensity": "low"},
        }

    return _response(200, {
        "proposed": proposed or {"activity": question or "unspecified", "intensity": "unknown"},
        "recommended": MODEL_PREDICTION,
        "comparison": comparison,
    })


# ---- Routing ----

MOCK_ROUTES = {
    ("POST", "/auth/demo"): (200, DEMO_MEMBER),
    ("POST", "/recovery/infer"): (200, MODEL_PREDICTION),
    ("POST", "/coach/messages"): (200, COACH_MESSAGE),
}

REAL_ROUTES = {
    ("POST", "/onboarding"): handle_onboarding,
    ("POST", "/checkins"): handle_checkin,
    ("POST", "/activities"): handle_activity,
    ("POST", "/wearables/simulate"): handle_wearable_simulate,
    ("POST", "/simulations"): handle_simulation,
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