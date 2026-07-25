# System Context — Discovery GradHack 2026

Single source of truth for the whole stack: mobile app, backend, and the two
ML models. Written so that a person or an AI assistant joining any one
workstream can get productive without reading the other three.

**Last verified:** 2026-07-25, all live resources confirmed working end to end,
coaching layer included.

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
| POST | `/coach/messages` | **Real** — Gemini, grounded in the stored prediction |

### Env vars
```
MEMBERS_TABLE=recovery-members
TIMESERIES_TABLE=recovery-timeseries
CONVERSATIONS_TABLE=recovery-conversations
SAGEMAKER_ENDPOINT=recovery-combined-endpoint   # empty string = mock mode
SAGEMAKER_REGION=eu-west-1
LLM_PROVIDER=gemini                             # gemini | mock
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_KEY=<set out of band, never in git>
LLM_TIMEOUT_SECONDS=12                          # optional
LLM_MAX_OUTPUT_TOKENS=1200                      # optional
LLM_THINKING_BUDGET=0                           # optional
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
dashboard loads are ~0.9s. Check-ins always re-infer (SageMaker ~1s warm, plus
~6s of coach generation). A cold serverless container takes several seconds to
start.

---

## 6a. The coaching layer (APO + Gemini)

Two modules, both stdlib-only — the Lambda ships no packaged dependencies.

### `prompt_orchestrator.py` — Adaptive Prompt Orchestrator
**Makes no health decisions.** The readiness class, VO2 forecast, and the
activity/duration/intensity plan are all decided upstream by the models and the
rules in `inference.py`. The APO only assembles them with member context into
one consistent prompt.

- `member_context()` — reads the **real** schema: `recoveryGoal`,
  `recoveryContext.{conditionCategory, severity, recoveryStage,
  mobilityLimitation, clinicianCleared, contraindicationFlag, vo2RiskBand,
  medicationImpact}`. Current pain/fatigue come from the latest `CHECKIN#`,
  **not** the intake profile's `painScore`. Verified: 16/16 fields populate.
- `authoritative_plan()` — the decision the LLM must explain and cannot alter,
  including `reason_codes` (`RECOVERY_REQUIRED`, `PAIN_LOW`, `SLEEP_ADEQUATE`,
  `INCONSISTENT_ADHERENCE`, …) derived from the readiness class and the
  threshold checks in `top_factors`.
- `build_coach_prompt()` — assembles everything with `SYSTEM_RULES`.
- `PROMPT_VERSION` is stamped onto every stored prediction.

### `llm_client.py` — provider-switched LLM call
- `generate_coach_message()` **never raises.** Missing key, timeout, HTTP
  error, safety block or malformed output all fall back to safe canned text.
- The fallback is **plan-aware and never names an activity or duration**, so it
  cannot reintroduce the contradiction described in §7.
- `responseSchema` forces the four prose fields.
- API key is sent as an `x-goog-api-key` header, not a query parameter, so it
  cannot land in an access log.

### The safety property that matters
**Gemini cannot emit plan fields at all.** It returns only `summary`,
`explanation`, `coaching_message`, `follow_up_question`. The app renders
activity/duration/intensity from the *model*. A contradiction between the
coaching text and the plan is therefore impossible by construction, not
something a validator has to catch.

### When it runs
Generation happens **with inference** on `/checkins` and `/activities`, and the
result is stored on the `PREDICTION#` item as `coach`, along with
`coach_source`, `coach_provider` and `coach_prompt_version`. Dashboard loads
read the stored text and never call Gemini.

`generate_coach_message()` returns `(prose, source)` — always destructure it;
it is not a bare dict.

### Gemini gotchas already hit (don't rediscover these)
1. **`gemini-2.5-flash` returns 404 for new API keys**, even though ListModels
   still advertises it. ListModels is not an availability signal — test with an
   actual `generateContent` call.
2. **`gemini-3.5-flash` is a thinking model.** With `maxOutputTokens: 400` it
   spent 384 tokens reasoning, hit `MAX_TOKENS`, and returned *empty content*.
   `thinkingBudget: 0` plus a 1200 ceiling fixes it; explaining an
   already-decided plan needs no reasoning phase.
3. **A 6s timeout is too short.** 12s works and still falls back before the
   app's 20s client timeout.
4. Logs record `durationMs`, `finishReason` and `thoughtTokens` — an empty
   candidate is ambiguous between `MAX_TOKENS` and a safety block, and
   `finishReason` is what tells them apart.

Current latency: **5.7–6.9s**, `finishReason: STOP`.

### Is it actually using Gemini?
Read **`coach_source`** on the prediction — it records what actually wrote the
text:

| Field | Meaning |
|---|---|
| `coach_source` | **`gemini`** or **`fallback`** — what really produced the prose |
| `coach_provider` | Only echoes the `LLM_PROVIDER` setting. Says `gemini` even when generation failed — do not use it to judge success |
| `coach_prompt_version` | APO version stamp (`apo-v1`) |

The UI surfaces this too: the rationale card is titled "Gemini AI Rationale"
when `coachSource === 'gemini'`, and "Standard Guidance (AI Unavailable)"
otherwise. That is **separate from Marnus's `dataSource` badge**, which tracks
whether the dashboard fetch reached DynamoDB — the two can disagree, and a
live fetch with a failed LLM call legitimately shows LIVE DYNAMODB next to
fallback coaching.

By eye: fallback text always opens "Your updated recovery plan is ready." or
"Today is a recovery day."; real output cites the member's own goal, their
check-in numbers, and the reason codes.

```bash
aws logs tail /aws/lambda/RecoveryPlatformStack-ApiFnE0725F78-KIYezPWTw6wR \
  --region eu-central-1 --since 15m --filter-pattern coach
```

---

## 7. Frontend

Expo 57 / React Native 0.86 / TypeScript. `npm install` then `npx expo start`.
No `.env`, no AWS credentials needed — `BASE_URL` is hardcoded in `src/api.ts`
and the API has no authorizer.

- `src/api.ts` — fetch layer. `adaptDashboard()` flattens the backend response
  into the `RecoveryData` the screens consume, mixing model outputs with
  values it computes itself from raw readings (resting-HR delta, 7-day strain,
  VO2 baseline vs current). `TIMEOUT_MS = 20000` — sized for cold starts; at
  the previous 5s the app silently fell back to mocks.
- `src/screens/` — `DashboardScreen`, `LoginScreen`, `SimulatorScreen`
- `src/components/` — `DailyCheckInModal`, `TrendChart`, `VitalityScoreRing`,
  `WearableSimulatorModal`

### Still mock in the UI
- **7-day trend chart** — hardcoded in `TrendChart.tsx`, identical for every
  member. (Reworked in "Verion1.2"; re-verify whether it now has a data source.)
- **What-if simulator** — `/simulations` scans the question for words like
  "run", "sprint", "heavy" and returns hardcoded probabilities (0.44 vs 0.19).
  It never invokes a model.
### Wearable recovery trend simulator (presenter tool)
`src/components/WearableSimulatorModal.tsx`, opened from SimulatorScreen via
the amber "▶ Recovery Trend Simulator (Demo)" button.

Steps a member's wearable trend forward one day or week at a time and shows
the real pipeline reacting. Four deterministic scenarios — improving, stable,
declining, setback — with no randomness, so a rehearsed demo behaves the same
every run. Preview shows before → after per metric, coloured by whether the
move is good for that metric (lower is better for resting HR, pain, fatigue).

Each metric goes to the endpoint that already owns it:

| Data | Endpoint | Item |
|---|---|---|
| restingHr, hrBaseline, vo2max, sleepHours, steps, activeMinutes, **hrvMs** | `/wearables/simulate` | `READING#` |
| pain, fatigue, confidence, symptoms | `/checkins` | `CHECKIN#` |
| RPE | **not submitted** — belongs to `/activities`, and no workout occurs | — |

**Two things that make this work, both easy to break:**

1. **Both requests carry the same simulated `timestamp`.** `inference.py` keys
   sessions by date, so a check-in stamped "now" against future-dated readings
   lands on an older session and its pain never reaches the model. The symptom
   is subtle: predictions stop responding and identical values come back for
   very different pain levels. `/checkins` and `/wearables/simulate` both
   accept an optional `timestamp`; the simulator sets both.
2. **Setback uses pain +5, not +4.** From the default baseline of 2 that
   reaches 7, which is where the model flips to REDUCE. At 6 it stays
   MAINTAIN and only the risk number moves, which makes the demo look flat.

Verified live: setback step → **REDUCE / rest / 85% setback**; improving step
→ **MAINTAIN / walk 20 min / 22%**.

`submitCheckIn()` returns the fresh prediction and coach text, so the modal
shows the model reacting immediately. DashboardScreen also refetches on focus
— without that, returning from the simulator showed the stale prediction.

### Two independent status indicators
- **`dataSource` badge** (green "LIVE DYNAMODB" / amber "MOCK FALLBACK") —
  whether the dashboard fetch reached the backend.
- **Rationale card title** — whether Gemini or the fallback wrote the prose.

They are deliberately separate and can disagree. Neither is cosmetic: both
fallbacks are silent by design, and these labels are the only on-screen tell.

**Naming leftover:** the field behind the rationale card is still
`explainability.bedrock_rationale` in `mockData.ts` / `api.ts` /
`DashboardScreen.tsx`. The visible label was corrected; the field name was
left to avoid colliding with in-flight dashboard work. **Bedrock is not wired
up anywhere** — don't infer otherwise from that name.

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
7. **Bedrock is blocked by an organisation SCP** — an explicit deny on the
   parent org (`602777777415`), not something any IAM change in this account
   can override:
   ```
   AccessDeniedException … explicit deny in a service control policy:
   arn:aws:organizations::602777777415:policy/…/p-efnfvaoe
   ```
   That is why the coach uses Gemini. SCPs govern AWS API calls only, so
   outbound HTTPS from the Lambda to Google is unaffected. If a judge asks why
   the stack is not fully AWS-native, that error is the answer.
8. **The Gemini API key is short-lived.** When it expires the coach silently
   reverts to fallback text — no error, just canned wording. Set a fresh key
   before demoing (§9).
9. **`prepared_data/master_dataset_with_identifiers.csv` contains names, ages
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

### Setting or rotating the Gemini API key

1. Create a key at <https://aistudio.google.com/apikey> — no GCP project or
   billing setup needed; the free tier covers a demo.
2. Confirm which models that key can actually call (ListModels over-reports —
   see §6a):
   ```powershell
   $key = "PASTE_KEY"
   $body = '{"contents":[{"parts":[{"text":"hi"}]}]}'
   foreach ($m in @("gemini-3.5-flash","gemini-3.6-flash","gemini-flash-latest","gemini-3.1-flash-lite")) {
     try {
       $null = Invoke-RestMethod -Uri "https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent" `
         -Method POST -Headers @{"x-goog-api-key"=$key} -ContentType "application/json" -Body $body
       "OK    $m"
     } catch { "FAIL  $m" }
   }
   ```
   Prefer a non-`preview`, non-`latest` id so it can't shift mid-demo.
3. Apply it. **Every variable must be present — the API replaces the whole
   map, so omitting one wipes it:**
   ```powershell
   aws lambda update-function-configuration `
     --function-name RecoveryPlatformStack-ApiFnE0725F78-KIYezPWTw6wR `
     --region eu-central-1 `
     --environment "Variables={SAGEMAKER_ENDPOINT=recovery-combined-endpoint,SAGEMAKER_REGION=eu-west-1,CONVERSATIONS_TABLE=recovery-conversations,MEMBERS_TABLE=recovery-members,TIMESERIES_TABLE=recovery-timeseries,LLM_PROVIDER=gemini,GEMINI_MODEL=gemini-3.5-flash,GEMINI_API_KEY=YOUR_KEY}"
   ```
4. Verify — real output cites the member's own goal and check-in values:
   ```powershell
   $r = Invoke-RestMethod -Uri "https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev/checkins" `
     -Method POST -ContentType "application/json" `
     -Body '{"memberId":"ENT000122","pain":2,"fatigue":2,"confidence":4}'
   $r.coach | ConvertTo-Json
   ```

**Never** put the key in `infra-stack.ts`, the app, a commit, or a chat/screen
share — this repo is public. `LLM_PROVIDER=mock` disables the LLM entirely
without removing anything.

---

## 9a. Demo-day checklist

1. **Set a fresh Gemini key** (§9). The old one expires into silent fallback.
2. **Warm the endpoint** — submit one check-in a few minutes before
   presenting. First call after idle takes ~10s; warm calls are under 1s.
3. **Confirm it is live** — `coach_source` should read `gemini`, and the
   dashboard badge should read LIVE DYNAMODB.
4. **Pick a demo member with history.** ENT000122 has extra simulated readings
   dated into the future from testing; ENT000047 is cleaner.
5. **Open the simulator once** before presenting so the first (slow) call is
   already paid for.

### Numbers worth quoting, and how to frame them
- Readiness model: **macro F1 0.712**, balanced accuracy 0.757 on a genuine
  next-session prediction task.
- VO2 model: **16.7% better than a persistence baseline** (MAE 0.633 vs
  0.760). Quote that, not R² 0.985 — see §3.
- **Do not quote the 0.999 model.** It is circular and not deployed (§3).
- `top_factors` is **not SHAP**, and `recovery_score` is a hand-weighted blend
  of the model's probabilities, not a model output (§4).
- If asked why not fully AWS-native: **Bedrock is denied by an org SCP** (§8),
  with the exact error to show.

## 9b. Working copies — read this before debugging "my changes did nothing"

There are **three checkouts of this project** on the original dev machine:

| Path | Role |
|---|---|
| `Desktop\DataDiscovery\recovery-platform` | VS Code working copy |
| `Desktop\ai moddel\Gradhack-2026` | second clone, same repo/branch |
| `Desktop\ai moddel\Gradhack-aiModels` | the models repo |

The first two are the same repo on the same `dev2` branch. Edits in one are
invisible in the other until pushed and pulled, and Metro may be serving a
different folder than the editor has open. This already caused an hour of
confusion. Pick one canonical checkout.

## 10. Open work

| Item | Status |
|---|---|
| LLM coach (APO + Gemini) | **done** — live, §6a |
| Wearable trend simulator | **done** — logic verified against live AWS; bundles clean, but never manually clicked through |
| Set a fresh Gemini key before judging — the current one is short-lived | **required** |
| Relabel "AWS Bedrock Rationale" → Gemini | **done** — plus a truthful `coach_source` |
| Rename the `bedrock_rationale` field (label fixed, field name stale) | unassigned |
| Make `/simulations` invoke the model instead of keyword matching | unassigned |
| Surface `predicted_vo2_4_weeks` in the UI — Model 2's output is unused | unassigned |
| Replace the activity rule (`_plan_activity`) — see the defect in §7 | teammates |
| Real SHAP attribution to replace rule-based `top_factors` | unassigned |
| Real 7-day trend from stored `PREDICTION#` history | unassigned |
| Delete the two superseded endpoints | unassigned |
| `.gitignore` for `Gradhack-aiModels` (~200 MB CSVs, committed `.pyc`) | unassigned |
