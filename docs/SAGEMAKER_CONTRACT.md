# SageMaker Inference Contract (Member 1 ↔ Member 4)

The API Lambda calls the SageMaker endpoint **synchronously** on every check-in
and activity log (and on dashboard load when no stored prediction exists yet).
It sends raw member data; the inference script computes the engineered features
(so they exactly match Member 2's training features) and returns one combined
prediction for both models.

## Integration switch

Backend is already deployed and ready. To go live, set the Lambda env var
`SAGEMAKER_ENDPOINT` (in `infra/lib/infra-stack.ts`) to the endpoint name and
redeploy — no code changes. While unset, the API returns the mock prediction.
On any inference failure the API logs the error and falls back to the mock, so
a broken endpoint can never break the app/demo.

## Request (what the endpoint receives)

`ContentType: application/json`

```json
{
  "memberId": "ENT000122",
  "member": { "...": "full recovery-members item (profile + recoveryContext)" },
  "history": [
    { "sk": "CHECKIN#2026-07-25T10:00:00Z", "type": "CHECKIN", "pain": 2, "fatigue": 3, "symptoms": [], "confidence": 4, "createdAt": "..." },
    { "sk": "ACTIVITY#2026-07-24T17:30:00Z", "type": "ACTIVITY", "activityType": "walk", "durationMinutes": 20, "intensity": "low", "perceivedExertion": 4, "createdAt": "..." },
    { "sk": "READING#2026-07-24T08:00:00Z", "type": "READING", "restingHr": 58, "hrBaseline": 55, "vo2max": 31.2, "sleepHours": 7.5, "steps": 6200, "activeMinutes": 42, "createdAt": "..." }
  ]
}
```

`history` = up to 60 newest timeseries items, mixed types, newest first.
Compute rolling features (7-day averages, days-since-event, VO2 trend) from
these inside `inference.py`'s `predict_fn`.

## Response (what the endpoint must return)

JSON, the plan §10.1 prediction shape (both models' outputs combined):

```json
{
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
    { "feature": "resting_hr_deviation", "direction": "positive" }
  ],
  "model_version": "recovery-mtl-0.1.0"
}
```

The Lambda persists this verbatim as a `PREDICTION#<timestamp>` item in
`recovery-timeseries` — Member 4's workflow does NOT need table access.

## Deployment suggestions (Member 4)

- Upload `model.tar.gz` (model.joblib + code/inference.py) to
  `s3://recovery-ml-435614981173/models/`
- Prebuilt scikit-learn container (SKLearn framework model) — no custom Docker
- **Serverless endpoint** (e.g. 2048 MB, max concurrency 5): zero idle cost,
  ~1–3s cold start. Lambda timeout already has headroom (25s).
- One endpoint returning both models' outputs in the single JSON above
  (cheaper + one network hop; run both models inside `predict_fn`).
