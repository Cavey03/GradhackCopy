// src/api.ts
// Live API layer: talks to the AWS backend and adapts its responses into the
// RecoveryData shape the screens consume. Falls back to mock data when the
// network is unreachable so the demo can never break.
import {
  OPTIMAL_STATE,
  WARNING_STATE,
  RecoveryData,
  ExercisePlan,
  WeekPlanDay,
  PlanEnvelope,
} from './mockData';

export const BASE_URL =
  'https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev';

// Warm requests return in well under a second, but a check-in or a first
// dashboard load invokes the SageMaker serverless endpoint, and a cold
// container takes ~10s to start. 5s aborted those and silently dropped the
// app onto mock data.
//
// Raised from 20s once the LLM began authoring the plan: a measured cold
// check-in (container start + inference + a full plan generation) took 18.3s,
// which left almost no margin. The Lambda's own timeout is 25s and API
// Gateway's hard limit is 29s, so at 25s the app now waits exactly as long as
// the backend can possibly run and no longer gives up while a valid response
// is still in flight.
const TIMEOUT_MS = 25000;

// ---------- Backend response shapes (see docs/API_CONTRACT.md) ----------

interface BackendPrediction {
  recovery_score: number;
  readiness_score: number;
  recovery_stage: number;
  recovery_trend: string; // "improving" | "stable" | "declining"
  setback_probability: number;
  recommended_activity: string; // "walk" | "run" | "swim"
  duration_minutes: number;
  intensity: string; // "very_low" | "low" | "moderate"
  confidence: number;
  top_factors?: { feature: string; direction: string }[];
  // Set by the backend to whatever actually produced the coaching text.
  // 'not_requested' = no LLM call was made for this prediction.
  coach_source?: 'gemini' | 'fallback' | 'not_requested';
  // Present only when the backend has plan generation switched on. The
  // headline fields above are derived from exercise_plan when it exists, so
  // the two can never disagree.
  exercise_plan?: ExercisePlan;
  week_plan?: WeekPlanDay[];
  // The model-derived limits the plan was validated against.
  plan_envelope?: PlanEnvelope;
  // Whether the LLM's plan survived validation against the model's envelope,
  // or was rejected in favour of the deterministic plan.
  plan_source?: 'gemini' | 'rules' | 'not_requested';
}

interface BackendReading {
  sk: string;
  sleepHours?: number;
  sleepQualityScore?: number;
  restingHeartRate?: number; // seeded spelling
  restingHr?: number; // /wearables/simulate spelling
  hrvMs?: number;
  vo2MaxEstimate?: number; // seeded spelling
  vo2max?: number; // /wearables/simulate spelling
}

interface BackendActivity {
  sk: string;
  workoutType?: string; // seeded spelling
  activityType?: string; // app-written spelling
  durationMin?: number; // seeded spelling
  durationMinutes?: number; // app-written spelling
  avgHeartRate?: number;
  maxHeartRate?: number;
  caloriesBurned?: number;
  rpe?: number; // seeded spelling
  perceivedExertion?: number; // app-written spelling
  distanceKm?: number;
  distance?: number;
}

interface BackendDashboard {
  member: {
    memberId: string;
    firstName?: string;
    surname?: string;
    injury?: string;
    vo2max?: { baseline?: number; current?: number };
  };
  latestCheckin: Record<string, unknown> | null;
  recentReadings?: BackendReading[];
  recentActivities?: BackendActivity[];
  oldestReading?: BackendReading | null;
  prediction: BackendPrediction;
  coach: {
    summary: string;
    explanation: string;
    coaching_message: string;
    follow_up_question: string;
  };
  // Real once the backend generates plans; the static demo plan otherwise.
  weekPlan?: WeekPlanDay[];
  exercisePlan?: ExercisePlan;
  planSource?: 'gemini' | 'rules' | 'not_requested';
}

interface BackendSimulation {
  proposed: { activity: string; distanceKm?: number; intensity: string };
  recommended: BackendPrediction;
  comparison: {
    setback_probability_proposed: number;
    setback_probability_recommended: number;
    verdict: string; // e.g. "not_advised"
    saferAlternative: { activity: string; durationMinutes: number; intensity: string };
  };
}

export class MemberNotFoundError extends Error {
  constructor(public memberId: string) {
    super(`Member ${memberId} not found`);
  }
}

// ---------- Fetch helper (with real timeout; RN fetch has no timeout option) ----------

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (response.status === 404 && json?.error === 'member_not_found') {
      throw new MemberNotFoundError(json.memberId);
    }
    if (!response.ok) throw new Error(`API ${response.status} on ${path}`);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Adapter: backend dashboard -> flat RecoveryData for the UI ----------

const title = (s: string) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function adaptDashboard(d: BackendDashboard): RecoveryData {
  const p = d.prediction;
  const atRisk = p.setback_probability >= 0.4;
  const template = atRisk ? WARNING_STATE : OPTIMAL_STATE;

  const readings = d.recentReadings ?? [];
  const activities = d.recentActivities ?? [];
  const num = (v: unknown): v is number => typeof v === 'number';
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const round1 = (x: number) => Math.round(x * 10) / 10;

  // Process & format up to 7 most recent activities from DB
  const recentActivities = activities.slice(0, 7).map((act) => {
    const rawDate = act.sk ? act.sk.replace('ACTIVITY#', '') : '';
    const formattedDate = rawDate.length >= 10 ? rawDate.slice(0, 10) : 'Recent';
    return {
      sk: act.sk,
      name: act.workoutType ?? act.activityType ?? 'Workout',
      calories: act.caloriesBurned ?? null,
      avgHr: act.avgHeartRate ?? null,
      date: formattedDate,
      distanceKm: act.distanceKm ?? act.distance ?? null,
    };
  });
  const sleepNights = readings.map((r) => r.sleepHours).filter(num);
  const sleep = sleepNights.length
    ? { latestHours: sleepNights[0], avgHours: round1(avg(sleepNights)), nights: sleepNights.length }
    : undefined;

  const hrs = readings.map((r) => r.restingHeartRate ?? r.restingHr).filter(num);
  const hrvs = readings.map((r) => r.hrvMs).filter(num);
  const heart = hrs.length
    ? {
        restingHr: hrs[0],
        hrvMs: hrvs.length ? hrvs[0] : null,
        deltaVsAvg: hrs.length > 1 ? Math.round(hrs[0] - avg(hrs.slice(1))) : null,
      }
    : undefined;

  const durations = activities.map((a) => a.durationMin ?? a.durationMinutes).filter(num);
  const rpes = activities.map((a) => a.rpe ?? a.perceivedExertion).filter(num);
  const last = activities[0];
  const strain = last
    ? {
        lastWorkoutType: last.workoutType ?? last.activityType ?? 'Workout',
        lastWorkoutMin: last.durationMin ?? last.durationMinutes ?? null,
        lastAvgHr: last.avgHeartRate ?? null,
        load7dMin: Math.round(durations.reduce((a, b) => a + b, 0)),
        workouts: activities.length,
        avgRpe: rpes.length ? round1(avg(rpes)) : null,
      }
    : undefined;

  const vo2s = readings.map((r) => r.vo2MaxEstimate ?? r.vo2max).filter(num);
  const vo2Current = vo2s.length ? vo2s[0] : d.member.vo2max?.current;
  const oldestVo2 = d.oldestReading ? (d.oldestReading.vo2MaxEstimate ?? d.oldestReading.vo2max) : undefined;
  const vo2Baseline = num(oldestVo2) ? oldestVo2 : d.member.vo2max?.baseline;

  const lastReadingDate = readings.length ? readings[0].sk.slice('READING#'.length, 'READING#'.length + 10) : undefined;

  // A generated plan is the only thing that unlocks the structured plan UI.
  // The backend still returns a static demo weekPlan when none exists, and
  // rendering that would put a fabricated week in front of the member — the
  // same silent-mock problem the dataSource badge exists to prevent.
  const exercisePlan = p.exercise_plan ?? d.exercisePlan;

  return {
    dataSource: 'LIVE_API',
    // Falls back to 'fallback' for predictions stored before the coach layer.
    coachSource: p.coach_source ?? 'fallback',
    exercisePlan,
    planEnvelope: exercisePlan ? p.plan_envelope : undefined,
    weekPlan: exercisePlan ? p.week_plan ?? d.weekPlan : undefined,
    planSource: exercisePlan ? p.plan_source ?? d.planSource ?? 'not_requested' : undefined,
    member: {
      memberId: d.member.memberId,
      firstName: d.member.firstName ?? template.member?.firstName,
      surname: d.member.surname ?? template.member?.surname,
      injury: d.member.injury ?? (atRisk ? 'Elevated Strain Risk' : 'None / Cleared'),
    },
    sleep,
    heart,
    strain,
    lastReadingDate,
    recovery_score: p.recovery_score,
    readiness_score: p.readiness_score,
    recovery_stage: p.recovery_stage,
    recovery_trend: title(p.recovery_trend),
    setback_probability: p.setback_probability,
    recommended_activity: title(p.recommended_activity),
    duration_minutes: p.duration_minutes,
    intensity: title(p.intensity),
    vo2_max_baseline: vo2Baseline ?? template.vo2_max_baseline,
    vo2_max_current: vo2Current ?? template.vo2_max_current,
    confidence: p.confidence,
    ai_summary: d.coach.summary,
    ai_coaching_message: d.coach.coaching_message,
    explainability: {
      primary_factor: p.top_factors?.length
        ? title(p.top_factors[0].feature)
        : template.explainability.primary_factor,
      resting_hr_delta:
        heart?.deltaVsAvg != null
          ? `${heart.deltaVsAvg >= 0 ? '+' : ''}${heart.deltaVsAvg} bpm vs baseline`
          : template.explainability.resting_hr_delta,
      sleep_debt: sleep
        ? `${Math.max(0, round1(7 - sleep.avgHours))} hrs`
        : template.explainability.sleep_debt,
      training_load_7d: strain
        ? `${strain.load7dMin} min / ${strain.workouts} workouts`
        : template.explainability.training_load_7d,
      bedrock_rationale: d.coach.explanation,
    },
  };
}

// ---------- Public API ----------

/**
 * Fetch the dashboard for a member.
 * - Throws MemberNotFoundError if the memberId doesn't exist (so Login can say so).
 * - Falls back to mock data on network failure (demo never breaks).
 */
export async function fetchDashboardData(memberId: string): Promise<RecoveryData> {
  try {
    const dashboard = await request<BackendDashboard>(
      'GET',
      `/dashboard?memberId=${encodeURIComponent(memberId)}`,
    );
    return adaptDashboard(dashboard);
  } catch (error) {
    if (error instanceof MemberNotFoundError) throw error;
    console.warn('⚠️ AWS API unavailable. Using fallback mock data.', error);
    return OPTIMAL_STATE;
  }
}

export interface CheckInDetails {
  sleepQuality: number; // 1-5 (5 = restful)
  soreness: number; // 1-5 (5 = severe)
  energy: number; // 1-5 (5 = energized)
  symptoms: string[];
  // Optional. Only the demo simulator sets it, so a simulated check-in lands
  // on the same date as its simulated wearable reading; the backend defaults
  // to now when omitted.
  timestamp?: string;
}

/**
 * Persist a daily check-in to DynamoDB (CHECKIN# item). Never throws:
 * returns { recorded: false } on failure so the demo flow can't block.
 */
export async function submitCheckIn(
  memberId: string,
  details: CheckInDetails,
): Promise<{ recorded: boolean; prediction?: BackendPrediction; coach?: BackendDashboard['coach'] }> {
  try {
    // The backend re-runs inference on every check-in and returns the fresh
    // prediction; surfacing it is additive, existing callers can ignore it.
    const res = await request<{ prediction?: BackendPrediction; coach?: BackendDashboard['coach'] }>(
      'POST',
      '/checkins',
      {
        memberId,
        pain: details.soreness,
        fatigue: 6 - details.energy, // invert: UI collects energy, model wants fatigue
        confidence: details.sleepQuality,
        symptoms: details.symptoms,
        ...(details.timestamp ? { timestamp: details.timestamp } : {}),
      },
    );
    return { recorded: true, prediction: res?.prediction, coach: res?.coach };
  } catch (error) {
    console.warn('⚠️ Check-in not persisted (API unreachable).', error);
    return { recorded: false };
  }
}

// ---------- Wearable telemetry (demo simulator) ----------

/**
 * One simulated wearable reading. Field names match what the backend writes
 * to READING# items and what the inference script reads, so no mapping is
 * needed anywhere in between. `hrvMs` is optional end-to-end.
 */
export interface WearableReading {
  timestamp: string; // ISO8601; the backend uses it as the READING# sort key
  restingHr: number;
  hrBaseline: number;
  vo2max: number;
  sleepHours: number;
  steps: number;
  activeMinutes: number;
  hrvMs?: number;
}

/**
 * Persist a simulated wearable reading (READING# item). Never throws:
 * returns { recorded: false } so a partial failure can be reported without
 * blocking the rest of the demo step.
 */
export async function simulateWearable(
  memberId: string,
  reading: WearableReading,
): Promise<{ recorded: boolean }> {
  try {
    await request('POST', '/wearables/simulate', { memberId, ...reading });
    return { recorded: true };
  } catch (error) {
    console.warn('⚠️ Wearable reading not persisted (API unreachable).', error);
    return { recorded: false };
  }
}

/**
 * Ask the backend to generate a fresh AI plan for this member.
 *
 * This is the only call in the app that spends an LLM request on demand, so
 * it is deliberately not called on mount or on focus — the screen puts it
 * behind an explicit button. One press = one Gemini request; the prose and
 * the plan come back together, so it is never more than one.
 *
 * Returns planSource so the caller can tell whether the LLM's plan survived
 * validation ('gemini') or was rejected in favour of the deterministic plan
 * ('rules'). Never throws.
 */
export async function generatePlan(
  memberId: string,
): Promise<{ ok: boolean; planSource?: 'gemini' | 'rules' | 'not_requested'; error?: string }> {
  try {
    const res = await request<{ planSource?: 'gemini' | 'rules' | 'not_requested' }>('POST', '/plan', { memberId });
    return { ok: true, planSource: res?.planSource };
  } catch (error) {
    console.warn('⚠️ Plan generation failed.', error);
    return { ok: false, error: error instanceof Error ? error.message : 'unknown' };
  }
}

export interface SimulationVerdict {
  status: 'approved' | 'warning';
  title: string;
  summary: string;
  bedrockRationale: string;
}

/**
 * Ask the backend to evaluate a proposed activity ("can I run 5km?").
 * Returns null on failure so the screen can fall back to its local logic.
 */
export async function evaluateActivity(
  memberId: string,
  question: string,
): Promise<SimulationVerdict | null> {
  try {
    const sim = await request<BackendSimulation>('POST', '/simulations', {
      memberId,
      question,
    });
    const risky = sim.comparison.verdict === 'not_advised';
    const proposedPct = Math.round(sim.comparison.setback_probability_proposed * 100);
    const recommendedPct = Math.round(sim.comparison.setback_probability_recommended * 100);
    const alt = sim.comparison.saferAlternative;
    return {
      status: risky ? 'warning' : 'approved',
      title: risky ? 'MODIFIED PROTOCOL RECOMMENDED' : 'SAFE TO PROCEED',
      summary: risky
        ? `This plan carries a ${proposedPct}% setback probability vs ${recommendedPct}% for your recommended plan. Safer alternative: ${alt.durationMinutes} min ${title(alt.activity)} at ${title(alt.intensity)} intensity.`
        : `Setback probability is ${proposedPct}%, within your safe range. Your physiological markers support this activity.`,
      bedrockRationale: `Recovery model compared your proposed plan (${proposedPct}% setback risk) against the AI-recommended plan (${recommendedPct}%) using your latest check-in and wearable trend data.`,
    };
  } catch (error) {
    console.warn('⚠️ Simulation API unreachable, using local fallback.', error);
    return null;
  }
}
