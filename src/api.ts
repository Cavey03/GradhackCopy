// src/api.ts
// Live API layer: talks to the AWS backend and adapts its responses into the
// RecoveryData shape the screens consume. Falls back to mock data when the
// network is unreachable so the demo can never break.
import { OPTIMAL_STATE, WARNING_STATE, RecoveryState } from './mockData';

export const BASE_URL =
  'https://3ist8udh05.execute-api.eu-central-1.amazonaws.com/dev';

const TIMEOUT_MS = 5000;

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
}

interface BackendDashboard {
  member: {
    memberId: string;
    firstName?: string;
    surname?: string;
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

function adaptDashboard(d: BackendDashboard): RecoveryState {
  const p = d.prediction;
  const atRisk = p.setback_probability >= 0.4;
  // The backend doesn't compute wearable-delta strings yet; borrow the
  // matching mock template so the explainability card stays fully populated.
  const template = atRisk ? WARNING_STATE : OPTIMAL_STATE;

  // ---- Real wearable stats from the member's readings (newest first) ----
  const readings = d.recentReadings ?? [];
  const activities = d.recentActivities ?? [];
  const num = (v: unknown): v is number => typeof v === 'number';
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const round1 = (x: number) => Math.round(x * 10) / 10;

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

  return {
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
export async function fetchDashboardData(memberId: string): Promise<RecoveryState> {
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
}

/**
 * Persist a daily check-in to DynamoDB (CHECKIN# item). Never throws:
 * returns { recorded: false } on failure so the demo flow can't block.
 */
export async function submitCheckIn(
  memberId: string,
  details: CheckInDetails,
): Promise<{ recorded: boolean }> {
  try {
    await request('POST', '/checkins', {
      memberId,
      pain: details.soreness,
      fatigue: 6 - details.energy, // invert: UI collects energy, model wants fatigue
      confidence: details.sleepQuality,
      symptoms: details.symptoms,
    });
    return { recorded: true };
  } catch (error) {
    console.warn('⚠️ Check-in not persisted (API unreachable).', error);
    return { recorded: false };
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
