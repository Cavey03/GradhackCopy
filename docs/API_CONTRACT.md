# Recovery Platform API — Frontend Contract

Base URL: `https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev`

All endpoints accept/return JSON. CORS is open (`*`), so Expo web works too.
Errors return `{ "error": "<code>" }` with a 4xx status — always check `res.ok`.

**Easiest path: copy `api.ts` into the Expo app and call `api.*` — types included.**

## Status legend
- ✅ **REAL** — persists to / reads from DynamoDB
- 🔶 **MOCK** — returns fixed contract JSON for now; response *shape* is final, values are placeholders

## Endpoints

| Method | Path | Status | Purpose |
|---|---|---|---|
| POST | `/auth/demo` | 🔶 | Demo "login" — returns a member object |
| POST | `/onboarding` | ✅ | Create member profile |
| POST | `/checkins` | ✅ | Daily symptom check-in |
| POST | `/activities` | ✅ | Log an activity |
| POST | `/wearables/simulate` | ✅ | Insert simulated wearable readings (batch, back-datable) |
| GET | `/dashboard?memberId=` | ✅ | Everything the home screen needs, one call |
| POST | `/recovery/infer` | 🔶 | On-demand model prediction |
| POST | `/simulations` | 🔶 | "What if I did X instead?" comparison |
| POST | `/coach/messages` | 🔶 | Coach chat reply |

Note: the `prediction` field inside real responses (checkins, activities, dashboard)
is itself still mock until the ML pipeline is wired in — but its shape is final.

## Recommended demo flow

1. `POST /auth/demo` → get `memberId`
2. `GET /dashboard?memberId=...` → render home screen (member, prediction, todaysPlan, weekPlan, coach)
3. `POST /checkins` → show returned `prediction` as the "updated readiness"
4. `POST /activities` → log today's plan as done
5. `POST /simulations` → the "should I run 5K?" wow moment
6. `POST /coach/messages` → chat screen

## Example: check-in

```
POST /checkins
{
  "memberId": "ENT000001",
  "pain": 2,
  "fatigue": 5,
  "symptoms": ["mild_soreness"],
  "confidence": 7,
  "mood": "ok"
}

201
{
  "status": "recorded",
  "checkinSk": "CHECKIN#2026-07-25T10:00:00Z",
  "prediction": { "recovery_score": 72.4, "readiness_score": 68.0, ... }
}
```

## Example: dashboard response (shape)

```json
{
  "member":        { "memberId": "...", "firstName": "...", "recoveryContext": {...}, "vo2max": {...} },
  "latestCheckin": { "sk": "CHECKIN#...", "pain": 2, "fatigue": 5, ... },
  "prediction":    { "recovery_score": 72.4, "recommended_activity": "walk", "top_factors": [...], ... },
  "todaysPlan":    { "activity": "walk", "durationMinutes": 20, "intensity": "low", "completed": false },
  "weekPlan":      [ { "day": 1, "activity": "walk", "durationMinutes": 15, "intensity": "very_low" }, ... ],
  "coach":         { "summary": "...", "explanation": "...", "coaching_message": "...", "follow_up_question": "..." }
}
```

Full field-level types are in `api.ts`. Backend contact: Kyle (Member 1).
