import json
from datetime import datetime, timezone


def lambda_handler(event, context):
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({
            "status": "ok",
            "service": "recovery-platform-api",
            "time": datetime.now(timezone.utc).isoformat(),
        }),
    }