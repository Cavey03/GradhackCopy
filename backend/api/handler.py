import json
import os
from datetime import datetime, timezone
from decimal import Decimal
import boto3
from boto3.dynamodb.conditions import Key


def _json_default(o):
    if isinstance(o, Decimal):
        return float(o) if o % 1 else int(o)
    raise TypeError(f"Not JSON serializable: {type(o)}")


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

    return _response(200, {
        "member": member,
        "latestCheckin": latest_checkin,
        # Fall back to the mock until Member 4's pipeline writes real predictions
        "prediction": latest_prediction or MODEL_PREDICTION,
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
    members_table.put_item(Item=item)
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
    timeseries_table.put_item(Item=item)

    # Mock prediction for now; later this triggers Member 4's inference pipeline
    return _response(201, {
        "status": "recorded",
        "checkinSk": item["sk"],
        "prediction": MODEL_PREDICTION,
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
    timeseries_table.put_item(Item=item)

    return _response(201, {
        "status": "recorded",
        "activitySk": item["sk"],
        "prediction": MODEL_PREDICTION,
    })


# ---- Routing ----

MOCK_ROUTES = {
    ("POST", "/auth/demo"): (200, DEMO_MEMBER),
    ("POST", "/wearables/simulate"): (201, {"status": "inserted"}),
    ("POST", "/recovery/infer"): (200, MODEL_PREDICTION),
    ("POST", "/simulations"): (200, SIMULATION_RESULT),
    ("POST", "/coach/messages"): (200, COACH_MESSAGE),
}

REAL_ROUTES = {
    ("POST", "/onboarding"): handle_onboarding,
    ("POST", "/checkins"): handle_checkin,
    ("POST", "/activities"): handle_activity,
    ("GET", "/dashboard"): handle_dashboard,
}


def lambda_handler(event, context):
    method = event.get("httpMethod", "")
    path = event.get("path", "")

    handler = REAL_ROUTES.get((method, path))
    if handler:
        return handler(event)

    route = MOCK_ROUTES.get((method, path))
    if route:
        status, body = route
        return _response(status, body)

    return _response(404, {"error": "not_found", "method": method, "path": path})

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
            batch.put_item(Item=item)
            written.append(item["sk"])

    return _response(201, {"status": "inserted", "count": len(written), "sks": written})