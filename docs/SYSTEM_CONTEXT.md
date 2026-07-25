# System Context — Discovery GradHack 2026

Single source of truth for the whole stack: mobile app, backend, and the two
ML models. Written so that a person or an AI assistant joining any one
workstream can get productive without reading the other three.

**Last verified:** 2026-07-25, all live resources confirmed working end to end.

---

## 1. What this system is

An AI health coach that helps members safely restart physical activity after
illness, injury, surgery, childbirth or long inactivity. A member checks in
daily; two XGBoost models score their recovery readiness and forecast their
VO2 max; the app shows a recovery score, a plan, and an explanation.

**Two repos:**

| Repo | Branch | Contains |
|---|---|---|
| `Ula-ops/Gradhack-2026` | `dev2` | Expo app, API Lambda, CDK infra, docs |
| `Doctor1ven/Gradhack-aiModels` | `main` | Training pipelines, trained models, SageMaker deployment |

---

## 2. Live AWS resources

AWS account **435614981173**. Note the deliberate two-region split.

### eu-central-1 (backend)
| Resource | Name |
|---|---|
| CloudFormation stack | `RecoveryPlatformStack` |
| API Gateway URL | `https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev` |
| API Lambda | `RecoveryPlatformStack-ApiFnE0725F78-KIYezPWTw6wR` |
| Lambda role | `RecoveryPlatformStack-ApiFnServiceRoleD18AAE0E-8Y4f57Gum4Si` |
| DynamoDB | `recovery-members`, `recovery-timeseries`, `recovery-conversations` |
| S3 | `recovery-ml-435614981173`, `recovery-uploads-435614981173` |

### eu-west-1 (models)
| Resource | Name |
|---|---|
| **Live endpoint** | **`recovery-combined-endpoint`** (serverless, 4096 MB, max concurrency 5) |
| SageMaker model | `recovery-combined-model` |
| Container image | `435614981173.dkr.ecr.eu-west-1.amazonaws.com/gradhack-health-coach-inference:py312-sagemaker` |
| Model artefact | `s3://sagemaker-eu-west-1-435614981173/gradhack-health-coach/models/combined/model.tar.gz` |
| Execution role | `arn:aws:iam::435614981173:role/service-role/AmazonSageMaker-ExecutionRole-20260725T090438` |

**Why two regions:** the custom inference container was built and pushed to
ECR in eu-west-1. The backend stack already existed in eu-central-1. Rather
than rebuild, the Lambda invokes cross-region — hence the `SAGEMAKER_REGION`
env var and the widened IAM grant.

**Legacy endpoints:** `recovery-readiness-endpoint` and `vo2-forecast-endpoint`
are single-model endpoints superseded by the combined one. They still run and
still cost nothing when idle, but nothing calls them. Safe to delete.

---

## 3. The two models

Both are scikit-learn `Pipeline` objects wrapping XGBoost, trained by
`Doctor1ven/Gradhack-aiModels`, both served from the one endpoint.

### Model 1 — readiness classifier
`recovery_readiness_longitudinal_pipeline.joblib`

- **Predicts:** the *next* session's readiness class.
- **Output:** three probabilities over `0=REDUCE, 1=MAINTAIN, 2=PROGRESS`.
- **Trained on:** 56,216 synthetic session pairs, 6,255 members, split by member.
- **Test performance:** macro F1 **0.712**, balanced accuracy **0.757**,
  REDUCE recall **0.761**, PROGRESS recall 0.825.

### Model 2 — VO2 forecaster
`vo2_forecast_pipeline.joblib`

- **Predicts:** `VO2 Max Estimate` four sessions ahead.
- **Output:** one float.
- **Trained on:** 37,451 rows, same member-wise split.
- **Test performance:** MAE **0.633**, RMSE 0.810, R² 0.985.
- **Honest framing:** R² 0.985 mostly reflects that VO2 barely moves in four
  weeks. The meaningful number is that it beats a persistence baseline
  (predict today's VO2) by **16.7%** — MAE 0.633 vs 0.760. Quote that, not R².

### Model 1's non-longitudinal sibling — do not use or quote
`model_outputs/recovery_readiness_pipeline.joblib` reports macro F1 **0.999**.
That number is circular: its `readiness_label` target is a deterministic rule
computed from the very columns fed in as features, so the model is re-learning
an if-statement. It is not deployed. Do not present it as performance.

### Both models: limitations to state openly
- Trained on **synthetic** longitudinal data; not clinically validated.
- REDUCE recall 0.761 means ~24% of should-be-REDUCE sessions are missed; in
  the test confusion matrix 395 true-REDUCE sessions were labelled PROGRESS.
  Model selection ranked macro F1 above REDUCE recall even though REDUCE
  recall is the safety-critical metric — a defensible but arguable choice.
- Training members had ~10 sessions each; seeded demo members have **3–4**.
  Rolling-window features are therefore computed over shorter history than
  training assumed, and pipeline imputers fill the gaps.

---

## 4. The endpoint contract

### Request
`POST` to `recovery-combined-endpoint`, `ContentType: application/json`

```json
{
  "memberId": "ENT000047",
  "member":  { "...full recovery-members item, profile + recoveryContext..." },
  "history": [ "...up to 60 newest timeseries items, mixed types, newest first..." ]
}
```

`inference.py` also accepts `{"instances": [ {...pre-engineered features...} ]}`
for direct testing against training rows.

### Response
```json
{
  "recovery_score": 58.5,
  "readiness_score": 83.5,
  "recovery_stage": 4,
  "recovery_trend": "improving",
  "setback_probability": 0.1652,
  "recommended_activity": "walk",
  "duration_minutes": 20,
  "intensity": "low",
  "predicted_days_to_milestone": 59,
  "confidence": 0.7128,
  "top_factors": [{ "feature": "pain_score", "direction": "positive" }],
  "model_version": "readiness-xgb-longitudinal-1.0+vo2-xgb-1.0",

  "readiness": "MAINTAIN",
  "readiness_label": 1,
  "probabilities": { "REDUCE": 0.1652, "MAINTAIN": 0.7128, "PROGRESS": 0.1219 },
  "current_vo2": 51.0,
  "predicted_vo2_4_weeks": 51.47,
  "predicted_vo2_change": 0.47,
  "sessions_used": 4
}
```

### What is model output vs. computed — read this before quoting any number

Only **four numbers** come from the models: three readiness probabilities and
one VO2 value. Everything else is derived in `inference.py`.

| Field | Source |
|---|---|
| `probabilities`, `readiness`, `readiness_label` | **Model 1, direct** |
| `setback_probability` | **Model 1** — P(REDUCE) passed through |
| `confidence` | **Model 1** — max probability |
| `predicted_vo2_4_weeks` | **Model 2, direct** |
| `predicted_vo2_change` | Model 2 minus current VO2 |
| `recovery_score` | Derived: `100 × (0.25·P_RED + 0.60·P_MAIN + 0.95·P_PROG)` — weights hand-picked |
| `readiness_score` | Derived: `100 × (1 − P_REDUCE)` |
| `recovery_trend` | Derived: VO2 change vs ±0.3 thresholds |
| `predicted_days_to_milestone` | Derived: `clamp(28 ÷ change, 7, 90)` |
| `recovery_stage` | **Not a model output** — text lookup on `recoveryContext.recoveryStage` |
| `recommended_activity`, `duration_minutes`, `intensity` | **Rules**, not ML — see §7 |
| `top_factors` | **Rules**, not SHAP — threshold checks (sleep ≥6.5, pain ≤3, RPE ≤7, HRV ≥35, …) |

---

## 5. Data pipeline

### Origin
`Fully_sorted2.xlsx` — sheets `Personal Information`, `Exercise Data`,
`Health Data`, joined on `Entity Number`. It feeds **both** paths below.

### Path A — live app data
`scripts/seed_data.py` takes the 60 members with the most workouts and writes:

- `recovery-members` — profile, with health nested under `recoveryContext`
- `recovery-timeseries` — **each Exercise Data row is split into two items**:
  - `ACTIVITY#<date>` — workoutType, workoutStatus, durationMin, distanceKm,
    avgHeartRate, maxHeartRate, caloriesBurned, rpe
  - `READING#<date>` — restingHeartRate, hrvMs, sleepHours, sleepQualityScore,
    vo2MaxEstimate

Currently 122 members / 690 timeseries items.

### Path B — training data (offline, already complete)
`generate_weekly_sessions.py` reads the same workbook and expands it into
**62,471 synthetic weekly sessions across 6,255 members** (real workouts
weren't longitudinal enough to learn from). Then `prepare_longitudinal_dataset.py`
and `prepare_vo2_dataset.py` build the targets, and the two `train_*.py`
scripts produce the `.joblib` pipelines.

### DynamoDB schema
Both timeseries tables use `memberId` (partition) + `sk` (sort), where `sk` is
`TYPE#ISO8601`:

| Prefix | Written by | Notes |
|---|---|---|
| `READING#` | seed script, `/wearables/simulate` | Two field spellings exist — see §8 |
| `ACTIVITY#` | seed script, `/activities` | Two field spellings exist |
| `CHECKIN#` | `/checkins` | pain, fatigue, symptoms, confidence, mood |
| `PREDICTION#` | Lambda after every inference | Full response JSON stored verbatim |

### Inference-time reassembly
`inference.py`'s `build_sessions()` merges `ACTIVITY#` + `READING#` + `CHECKIN#`
back into **one record per date** — reversing the seed script's split. It sorts
items oldest-first so that when several exist for one day, the **newest wins**.
Then `build_feature_row()` computes ~70 features matching the training formulas:
3-session rolling means and trends (VO2, HRV, sleep, RPE, pain, resting HR,
duration), days since previous session, cumulative training load, completion rate.

---

## 6. Backend

`backend/api/handler.py`, Python 3.12 Lambda, 25s timeout, behind an
API Gateway `{proxy+}` catch-all.

| Method | Path | Real or mock |
|---|---|---|
| GET | `/dashboard` | **Real** — DynamoDB + inference |
| POST | `/checkins` | **Real** — writes `CHECKIN#`, re-infers |
| POST | `/activities` | **Real** — writes `ACTIVITY#`, re-infers |
| POST | `/onboarding` | **Real** — writes member |
| POST | `/wearables/simulate` | **Real** — writes `READING#` items |
| POST | `/simulations` | **Mock** — keyword heuristic, see §7 |
| POST | `/auth/demo` | Mock — static demo member |
| POST | `/coach/messages` | Mock — static text |

### Env vars
```
MEMBERS_TABLE=recovery-members
TIMESERIES_TABLE=recovery-timeseries
CONVERSATIONS_TABLE=recovery-conversations
SAGEMAKER_ENDPOINT=recovery-combined-endpoint   # empty string = mock mode
SAGEMAKER_REGION=eu-west-1
```

### The mock-fallback design
`get_prediction()` returns the static `MODEL_PREDICTION` dict whenever
`SAGEMAKER_ENDPOINT` is unset **or any exception occurs**. The app therefore
never visibly breaks — but a broken backend also looks like a working one.

**To tell real from mock at a glance:** mock always returns
`recovery_score: 72.4` and `model_version: "recovery-mtl-0.1.0"`. Real
predictions vary per member and carry
`model_version: "readiness-xgb-longitudinal-1.0+vo2-xgb-1.0"`.

### Performance
`handle_dashboard` uses a stored `PREDICTION#` if one exists and only calls
SageMaker otherwise. All 121 members with history have been pre-computed, so
dashboard loads are ~0.9s. Check-ins always re-infer. A cold serverless
container takes several seconds to start.

---

## 7. Frontend

Expo 57 / React Native 0.86 / TypeScript. `npm install` then `npx expo start`.
No `.env`, no AWS credentials needed — `BASE_URL` is hardcoded in `src/api.ts`
and the API has no authorizer.

- `src/api.ts` — fetch layer. `adaptDashboard()` flattens the backend response
  into the `RecoveryState` the screens consume, mixing model outputs with
  values it computes itself from raw readings (resting-HR delta, 7-day strain,
  VO2 baseline vs current). `TIMEOUT_MS = 20000` — sized for cold starts; at
  the previous 5s the app silently fell back to mocks.
- `src/screens/` — `DashboardScreen`, `LoginScreen`, `SimulatorScreen`
- `src/components/` — `DailyCheckInModal`, `TrendChart`, `VitalityScoreRing`

### Still mock in the UI
- **7-day trend chart** — `TrendChart.tsx:9` is hardcoded, identical for every member.
- **All coach text** — summary, prescription sentence, and the card labelled
  **"AWS Bedrock Rationale"** all come from the static `COACH_MESSAGE` dict.
  **Bedrock is not used anywhere in this stack** and that label should change.
- **What-if simulator** — `/simulations` scans the question for words like
  "run", "sprint", "heavy" and returns hardcoded probabilities (0.44 vs 0.19).
  It never invokes a model.

### The activity recommendation is rules, not ML
`_plan_activity()` in `inference.py` maps the model's readiness class to an
activity: REDUCE → rest if pain ≥7 else a shorter walk; MAINTAIN → same
activity as last session, capped at 30 min; PROGRESS → preferred activity,
+5 min, moderate. **A teammate is replacing this with an LLM — do not
refactor it.**

**Known defect in that rule:** it reads "current session" as the newest *date*.
If the newest item is a check-in with no workout, `workout_type` and `duration`
are null and it falls back to `"walk"` / `20`. So a member whose last real
workout was a 34-minute run can be shown "20 min Walk" — a default that merely
looks plausible. The same nulls reach the model and get median-imputed. The LLM
work supersedes this; flagged so nobody mistakes the default for a prediction.

---

## 8. Gotchas

1. **Two field spellings everywhere.** Seeded items use `workoutType`,
   `durationMin`, `rpe`, `restingHeartRate`, `vo2MaxEstimate`; app-written
   items use `activityType`, `durationMinutes`, `perceivedExertion`,
   `restingHr`, `vo2max`. `inference.py` and `api.ts` both handle either.
   New code must too.
2. **Deploying old infra silently reverts to mocks.** `cdk deploy` from a
   checkout older than commit `c98f823` resets `SAGEMAKER_ENDPOINT` to `""`.
   No error — the dashboard just shows 72.4 again. Pull `dev2` first.
3. **DynamoDB rejects floats.** Use the existing `_to_dynamo()` helper to
   convert to `Decimal` before writing.
4. **Don't feed `PREDICTION#` items back into the model.** `_recent_history()`
   filters them out; keep that behaviour.
5. **SageMaker needs a single-platform Docker v2 manifest.** Default buildx
   output (OCI image index + provenance attestation) is rejected at
   `CreateModel`. `build_and_push.sh` passes `--provenance=false --sbom=false
   --output type=docker`. Also, SageMaker starts containers as
   `docker run <image> serve`, so the Dockerfile needs an `ENTRYPOINT` that
   absorbs that argument — a bare `CMD` gets replaced and the container exits.
6. **The API is completely open.** No Cognito authorizer on `{proxy+}`; anyone
   with the URL can read and write member data. Acceptable for a demo, but do
   not put real personal data behind it.
7. **`prepared_data/master_dataset_with_identifiers.csv` contains names, ages
   and diagnoses** and sits in a public repo. Only 59 distinct first names
   appear, which suggests generated names, but confirm before that repo stays
   public.

---

## 9. Common tasks

**Test the live API**
```bash
curl "https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev/dashboard?memberId=ENT000047"
```

**Check endpoint health**
```bash
aws sagemaker describe-endpoint --endpoint-name recovery-combined-endpoint --region eu-west-1 --query EndpointStatus
```

**Redeploy the models** (from `Gradhack-aiModels/deployment/combined/`) — repack
`model.tar.gz` with both `.joblib` files plus `code/inference.py`, upload to
the S3 path in §2, create a new endpoint config and call `update_endpoint`.
No Docker needed unless `inference.py`'s *dependencies* change; the container
loads whatever `inference.py` is in the archive.

**Warm before demoing.** Submit one check-in a few minutes ahead so the
serverless container is hot.

---

## 10. Open work

| Item | Owner |
|---|---|
| LLM coach — replaces all static coach text and the activity rule | teammates, in progress |
| Make `/simulations` invoke the model instead of keyword matching | unassigned |
| Surface `predicted_vo2_4_weeks` in the UI — Model 2's output is unused | unassigned |
| Real SHAP attribution to replace rule-based `top_factors` | unassigned |
| Real 7-day trend from stored `PREDICTION#` history | unassigned |
| Relabel "AWS Bedrock Rationale" | unassigned |
| Delete the two superseded endpoints | unassigned |
| `.gitignore` for `Gradhack-aiModels` (~200 MB CSVs, committed `.pyc`) | unassigned |
