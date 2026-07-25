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

// Amplify builds supply this; a laptop running `npx expo start` usually does
// not. Throwing when it is absent kills the app at import before any screen
// renders, which turns a missing .env into "the whole demo is broken". Falling
// back to the deployed stage URL keeps Amplify configurable without putting a
// startup landmine in front of anyone who clones the repo.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

const DEFAULT_API_URL = 'https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev';

if (!configuredApiUrl) {
  console.warn(
    `EXPO_PUBLIC_API_URL is not set; using the default stage URL (${DEFAULT_API_URL}). ` +
      'Set it in .env or the Amplify environment to point at a different backend.',
  );
}

export const BASE_URL = (configuredApiUrl || DEFAULT_API_URL).replace(/\/+$/, '');

// Mock data stays available for local development and deliberate demo builds,
// but production exports must opt in so an AWS outage cannot look like live data.
export const MOCK_FALLBACK_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_MOCK_FALLBACK === 'true' ||
  (__DEV__ && process.env.EXPO_PUBLIC_ENABLE_MOCK_FALLBACK !== 'false');

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
  readiness?: 'REDUCE' | 'MAINTAIN' | 'PROGRESS';
  probabilities?: Partial<Record<'REDUCE' | 'MAINTAIN' | 'PROGRESS', number>>;
  readiness_score: number;
  recovery_stage: number;
  recovery_trend: string; // "improving" | "stable" | "declining"
  setback_probability: number;
  recommended_activity: string; // "walk" | "run" | "swim"
  duration_minutes: number;
  intensity: string; // "very_low" | "low" | "moderate"
  confidence: number;
  top_factors?: { feature: string; direction: string }[];
  current_vo2?: number;
  predicted_vo2_4_weeks?: number;
  predicted_vo2_change?: number;
  // Set by the backend to whatever actually produced the coaching text.
  // 'not_requested' = no LLM call was made for this prediction.
  coach_source?: 'gemini' | 'fallback' | 'not_requested';
  coach?: BackendCoach;
  // Present only when the backend has plan generation switched on. The
  // headline fields above are derived from exercise_plan when it exists, so
  // the two can never disagree.
  exercise_plan?: ExercisePlan;
  week_plan?: WeekPlanDay[];
  // The model-derived limits the plan was validated against.
  plan_envelope?: PlanEnvelope;
  // Whether the LLM's plan survived validation against the model's envelope,
  // was rejected in favour of the deterministic plan, or was never requested.
  plan_source?: 'gemini' | 'rules' | 'not_requested';
}

interface BackendCoach {
  summary: string;
  explanation: string;
  coaching_message: string;
  follow_up_question: string;
}

interface BackendReading {
  sk: string;
  sleepHours?: number;
  sleepQualityScore?: number;
  restingHeartRate?: number;
  restingHr?: number;
  hrvMs?: number;
  vo2MaxEstimate?: number;
  vo2max?: number;
}

interface BackendActivity {
  sk: string;
  workoutType?: string;
  activityType?: string;
  durationMin?: number;
  durationMinutes?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  caloriesBurned?: number;
  rpe?: number;
  perceivedExertion?: number;
  distanceKm?: number;
  distance?: number;
}

interface BackendDashboard {
  // The raw DynamoDB member item. The backend returns it whole, so anything
  // the seed wrote is already on the wire — these fields are declared, not
  // newly fetched.
  member: {
    memberId: string;
    firstName?: string;
    surname?: string;
    injury?: string;
    vo2max?: { baseline?: number; current?: number };
    age?: number;
    gender?: string;
    dob?: string;
    city?: string;
    province?: string;
    vitalityStatus?: string;
    medicalAidPlan?: string;
    joinDate?: string;
    recoveryGoal?: string;
    activityBaseline?: string;
    recoveryContext?: {
      conditionCategory?: string;
      diagnosisOrEvent?: string;
      eventType?: string;
      eventDate?: string;
      severity?: string;
      recoveryStage?: string;
      mobilityLimitation?: string;
      medicationImpact?: string;
      vo2RiskBand?: string;
      clinicianCleared?: string;
      contraindicationFlag?: string;
      painScore?: number;
    };
  };
  latestCheckin: Record<string, unknown> | null;
  recentReadings?: BackendReading[];
  recentActivities?: BackendActivity[];
  oldestReading?: BackendReading | null;
  prediction: BackendPrediction;
  coach: BackendCoach;
  // Real once the backend generates plans; the static demo plan otherwise.
  weekPlan?: WeekPlanDay[];
  exercisePlan?: ExercisePlan;
  planSource?: 'gemini' | 'rules' | 'not_requested';
}

interface BackendCheckIn {
  status: 'recorded';
  checkinSk: string;
  prediction: BackendPrediction;
  coach: BackendCoach;
}

// Rewritten with the endpoint: /simulations no longer returns a hardcoded
// comparison, it returns a verdict judged against the model's plan envelope.
interface BackendSimulation {
  question: string;
  proposed: {
    activity: string | null;
    unmodelled: string | null;
    durationMinutes: number | null;
    intensity: string | null;
    distanceKm: number | null;
  };
  verdict: 'advised' | 'modify' | 'not_advised' | 'not_assessable' | 'follow_plan';
  headline: string;
  explanation: string;
  reasons: { code: string; detail: string }[];
  model: {
    readiness: string;
    setback_probability: number | null;
    confidence: number | null;
    model_version?: string;
  };
  envelope: {
    max_total_minutes: number;
    max_intensity: string;
    allowed_activities: string[];
    is_rest_day: boolean;
  };
  recommended: { activity: string; durationMinutes: number; intensity: string };
}

export class MemberNotFoundError extends Error {
  constructor(public memberId: string) {
    super(`Member ${memberId} not found`);
  }
}

// ---------- Fetch helper (with real timeout) ----------

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

const topReadinessClass = (p: BackendPrediction) => {
  const entries = Object.entries(p.probabilities ?? {})
    .filter((entry): entry is ['REDUCE' | 'MAINTAIN' | 'PROGRESS', number] => typeof entry[1] === 'number')
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    return {
      label: p.readiness,
      score: p.recovery_score,
    };
  }

  const [label, probability] = entries[0];
  return {
    label,
    score: Math.round(probability * 100),
  };
};

function adaptDashboard(d: BackendDashboard): RecoveryData {
  const p = d.prediction;
  const readinessClass = topReadinessClass(p);
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
  const vo2Trend = readings
    .slice()
    .reverse()
    .map((r) => r.vo2MaxEstimate ?? r.vo2max)
    .filter(num);
  const vo2Current = vo2s.length ? vo2s[0] : d.member.vo2max?.current;
  const oldestVo2 = d.oldestReading ? (d.oldestReading.vo2MaxEstimate ?? d.oldestReading.vo2max) : undefined;
  const vo2Baseline = num(oldestVo2) ? oldestVo2 : d.member.vo2max?.baseline;

  const lastReadingDate = readings.length ? readings[0].sk.slice('READING#'.length, 'READING#'.length + 10) : undefined;

  // A generated plan is the only thing that unlocks the structured plan UI.
  // The backend still returns a static demo weekPlan when none exists, and
  // rendering that would put a fabricated week in front of the member — the
  // same silent-mock problem the dataSource badge exists to prevent.
  const exercisePlan = p.exercise_plan ?? d.exercisePlan;
  const ctx = d.member.recoveryContext ?? {};

  return {
    dataSource: 'LIVE_API',
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

      // Passed through verbatim. Left undefined when the member item does not
      // carry them, so the Profile tab can omit a row rather than print a
      // placeholder that looks like missing data.
      age: num(d.member.age) ? d.member.age : undefined,
      gender: d.member.gender,
      dob: d.member.dob,
      city: d.member.city,
      province: d.member.province,
      vitalityStatus: d.member.vitalityStatus,
      medicalAidPlan: d.member.medicalAidPlan,
      joinDate: d.member.joinDate,
      recoveryGoal: d.member.recoveryGoal,
      activityBaseline: d.member.activityBaseline,

      conditionCategory: ctx.conditionCategory,
      diagnosisOrEvent: ctx.diagnosisOrEvent,
      eventType: ctx.eventType,
      eventDate: ctx.eventDate,
      severity: ctx.severity,
      recoveryStageText: ctx.recoveryStage,
      mobilityLimitation: ctx.mobilityLimitation,
      medicationImpact: ctx.medicationImpact,
      vo2RiskBand: ctx.vo2RiskBand,
      clinicianCleared: ctx.clinicianCleared,
      contraindicationFlag: ctx.contraindicationFlag,
      intakePainScore: num(ctx.painScore) ? ctx.painScore : undefined,
    },
    recentActivities,
    sleep,
    heart,
    strain,
    lastReadingDate,
    vo2BaselineDate: d.oldestReading?.sk?.slice('READING#'.length, 'READING#'.length + 10),
    vo2CurrentDate: readings.find((r) => num(r.vo2MaxEstimate ?? r.vo2max))
      ?.sk?.slice('READING#'.length, 'READING#'.length + 10),
    vo2ReadingCount: vo2s.length,
    // The ring now shows the top class probability rather than the
    // hand-weighted blend, so "53% MAINTAIN" is a number the model actually
    // produced instead of one assembled from three of them.
    recovery_score: readinessClass.score,
    recovery_label: readinessClass.label,
    readiness_score: p.readiness_score,
    recovery_stage: p.recovery_stage,
    recovery_trend: title(p.recovery_trend),
    setback_probability: p.setback_probability,
    recommended_activity: title(p.recommended_activity),
    duration_minutes: p.duration_minutes,
    intensity: title(p.intensity),
    vo2_max_baseline: vo2Baseline ?? template.vo2_max_baseline,
    vo2_max_current: p.current_vo2 ?? vo2Current ?? template.vo2_max_current,
    vo2_trend: vo2Trend.length >= 2 ? vo2Trend.slice(-7) : template.vo2_trend,
    vo2_forecast_4_weeks: p.predicted_vo2_4_weeks,
    vo2_predicted_change: p.predicted_vo2_change,
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
    if (MOCK_FALLBACK_ENABLED) {
      console.warn('⚠️ AWS API unavailable. Using clearly labelled fallback mock data.', error);
      return OPTIMAL_STATE;
    }
    throw error;
  }
}

export interface CheckInDetails {
  sleepQuality: number; // 1-10 (10 = restful)
  soreness: number; // 1-10 (10 = severe)
  energy: number; // 1-10 (10 = energized)
  symptoms: string[];
  // Only the demo simulator sets it, so a simulated check-in lands on the same
  // date as its simulated wearable reading. inference.py keys sessions by
  // date, so without it a simulated check-in lands on today while the readings
  // sit in the future and its pain never reaches the model.
  timestamp?: string;
}

/**
 * Persist a daily check-in. Never throws.
 *
 * Returns the raw `prediction` and `coach` (used by the wearable simulator to
 * show the model reacting) *and*, when `currentData` is supplied, a merged
 * `data` the dashboard can render directly. Two callers want different shapes;
 * returning both keeps either free to ignore the other.
 */
export async function submitCheckIn(
  memberId: string,
  details: CheckInDetails,
  currentData?: RecoveryData,
): Promise<{
  recorded: boolean;
  prediction?: BackendPrediction;
  coach?: BackendCoach;
  data?: RecoveryData;
}> {
  try {
    const response = await request<BackendCheckIn>('POST', '/checkins', {
      memberId,
      pain: details.soreness,
      fatigue: 11 - details.energy, // invert: UI collects energy, model wants fatigue
      confidence: details.sleepQuality,
      symptoms: details.symptoms,
      ...(details.timestamp ? { timestamp: details.timestamp } : {}),
    });
    const p = response.prediction;
    const coach = response.coach ?? p.coach;
    const readinessClass = topReadinessClass(p);
    if (!currentData) {
      return { recorded: true, prediction: p, coach };
    }
    return {
      recorded: true,
      prediction: p,
      coach,
      data: {
        ...currentData,
        dataSource: 'LIVE_API',
        coachSource: p.coach_source ?? 'fallback',
        recovery_score: readinessClass.score,
        recovery_label: readinessClass.label,
        readiness_score: p.readiness_score,
        recovery_stage: p.recovery_stage,
        recovery_trend: title(p.recovery_trend),
        setback_probability: p.setback_probability,
        recommended_activity: title(p.recommended_activity),
        duration_minutes: p.duration_minutes,
        intensity: title(p.intensity),
        confidence: p.confidence,
        vo2_max_current: p.current_vo2 ?? currentData.vo2_max_current,
        vo2_forecast_4_weeks: p.predicted_vo2_4_weeks,
        vo2_predicted_change: p.predicted_vo2_change,

        // The plan must come from this response, not survive from the previous
        // one. The backend re-runs both models on every check-in and rebuilds
        // the envelope, so carrying the old plan through left the session card
        // describing a walk while the headline above it said rest — and the
        // stale plan was validated against an envelope that no longer applies.
        //
        // A check-in with new pain deliberately drops a Gemini plan back to the
        // deterministic one: it was designed for limits that have since moved,
        // so the tab correctly invites a regenerate rather than keeping it.
        exercisePlan: p.exercise_plan,
        weekPlan: p.week_plan,
        planEnvelope: p.plan_envelope,
        planSource: p.plan_source,
        ai_summary: coach.summary,
        ai_coaching_message: coach.coaching_message,
        explainability: {
          ...currentData.explainability,
          primary_factor: p.top_factors?.length
            ? title(p.top_factors[0].feature)
            : currentData.explainability.primary_factor,
          bedrock_rationale: coach.explanation,
        },
      },
    };
  } catch (error) {
    console.warn('⚠️ Check-in not persisted (API unreachable).', error);
    return { recorded: false };
  }
}

// ---------- Wearable telemetry (demo simulator) ----------

/**
 * One simulated wearable reading. Field names match what the backend writes to
 * READING# items and what the inference script reads, so no mapping is needed
 * anywhere in between. `hrvMs` is optional end-to-end.
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
 * Persist a simulated wearable reading (READING# item). Never throws, so a
 * partial failure can be reported without blocking the rest of a demo step.
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

// ---------- Exercise logging ----------

export interface ExerciseLog {
  activityType: string;
  durationMin: number;
  distanceKm: number;
  avgHr: number;
  maxHr: number;
}

/**
 * Persist a manually logged workout (ACTIVITY# item) and re-run inference.
 *
 * Field names are translated to the ones handle_activity writes, and the
 * heart-rate and distance values are included so the Strain view can read them
 * back — the drawer collects them, so dropping them on the floor would make
 * the logged workout look emptier than what the member actually entered.
 */
export async function submitExerciseLog(
  memberId: string,
  log: ExerciseLog,
): Promise<{ recorded: boolean }> {
  try {
    await request('POST', '/activities', {
      memberId,
      workoutType: log.activityType,
      activityType: log.activityType,
      durationMin: log.durationMin,
      durationMinutes: log.durationMin,
      distanceKm: log.distanceKm,
      distance: log.distanceKm,
      avgHeartRate: log.avgHr,
      maxHeartRate: log.maxHr,
      completed: true,
    });
    return { recorded: true };
  } catch (error) {
    console.warn('⚠️ Exercise log not persisted (API unreachable).', error);
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
  status: 'approved' | 'warning' | 'neutral';
  title: string;
  summary: string;
  // What the backend understood the question to be asking, echoed back so a
  // misparse is visible instead of silently driving the verdict.
  parsed: string;
  // The model-derived limits the answer was judged against.
  limits: string;
  riskLabel: string;
  modelVersion?: string;
}

/**
 * Ask the backend to evaluate a proposed activity ("can I run 5km?").
 *
 * The answer is judged against the same model-derived envelope that bounds the
 * exercise plan, so a what-if verdict and the plan can never disagree. Costs no
 * LLM request. Returns null on failure so the screen can say so.
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

    const status =
      sim.verdict === 'advised' || sim.verdict === 'follow_plan'
        ? 'approved'
        : sim.verdict === 'not_assessable'
          ? 'neutral'
          : 'warning';

    const p = sim.proposed;
    const parsedBits = [
      p.durationMinutes ? `${p.durationMinutes} min` : null,
      p.distanceKm ? `${p.distanceKm} km` : null,
      p.activity ?? p.unmodelled ?? 'no activity recognised',
      p.intensity ? `at ${title(p.intensity)} intensity` : null,
    ].filter(Boolean);

    const risk = sim.model.setback_probability;
    return {
      status,
      title: sim.headline,
      summary: sim.explanation,
      parsed: parsedBits.join(' · '),
      limits: sim.envelope.is_rest_day
        ? 'Rest day — no activity permitted'
        : `${sim.envelope.max_total_minutes} min max · up to ${title(sim.envelope.max_intensity)} · ${
            sim.envelope.allowed_activities.map(title).join(', ') || 'rest only'
          }`,
      riskLabel:
        risk != null
          ? `${Math.round(risk * 100)}% setback risk today (${sim.model.readiness})`
          : `Readiness: ${sim.model.readiness}`,
      modelVersion: sim.model.model_version,
    };
  } catch (error) {
    console.warn('⚠️ Simulation API unreachable.', error);
    return null;
  }
}
