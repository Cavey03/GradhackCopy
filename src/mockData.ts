// src/mockData.ts

export interface MemberProfile {
  memberId: string;
  firstName?: string;
  surname?: string;
  injury?: string;
}

export interface ActivityItem {
  sk: string;
  name: string;
  calories: number | null;
  avgHr: number | null;
  date: string;
  distanceKm: number | null;
}

export interface RecoveryData {
  dataSource?: 'LIVE_API' | 'MOCK_FALLBACK';
  recovery_score: number;
  readiness_score: number;
  recovery_stage: number;
  recovery_trend: string;
  setback_probability: number;
  recommended_activity: string;
  duration_minutes: number;
  intensity: string;
  vo2_max_baseline: number;
  vo2_max_current: number;
  confidence: number;
  ai_summary: string;
  ai_coaching_message: string;
  explainability: {
    primary_factor: string;
    resting_hr_delta: string;
    sleep_debt: string;
    training_load_7d: string;
    bedrock_rationale: string;
  };
  // Profile data mapped from DynamoDB member record
  member?: MemberProfile;
  recentActivities?: ActivityItem[];
  sleep?: {
    latestHours: number;
    avgHours: number;
    nights: number;
  };
  heart?: {
    restingHr: number;
    hrvMs: number | null;
    deltaVsAvg: number | null;
  };
  strain?: {
    lastWorkoutType: string;
    lastWorkoutMin: number | null;
    lastAvgHr: number | null;
    load7dMin: number;
    workouts: number;
    avgRpe: number | null;
  };
  lastReadingDate?: string;
}

export const OPTIMAL_STATE: RecoveryData = {
  dataSource: 'MOCK_FALLBACK',
  member: {
    memberId: 'ENT000122',
    firstName: 'Marnus',
    surname: 'Nieman',
    injury: 'None (Cleared for full activity)',
  },
  recovery_score: 84.5,
  readiness_score: 88.0,
  recovery_stage: 1,
  recovery_trend: "Optimal",
  setback_probability: 0.08,
  recommended_activity: "Aerobic Zone 2 Run",
  duration_minutes: 35,
  intensity: "Moderate",
  vo2_max_baseline: 38.5,
  vo2_max_current: 37.8,
  confidence: 0.94,
  ai_summary: "Cardiovascular strain is low and HRV has fully stabilized.",
  ai_coaching_message: "You are clear for standard Zone 2 aerobic training today.",
  recentActivities: [
    { sk: 'ACTIVITY#2026-07-24', name: 'Zone 2 Run', calories: 420, avgHr: 142, date: '2026-07-24', distanceKm: 6.2 },
    { sk: 'ACTIVITY#2026-07-22', name: 'Road Cycling', calories: 510, avgHr: 138, date: '2026-07-22', distanceKm: 18.5 },
    { sk: 'ACTIVITY#2026-07-20', name: 'Recovery Walk', calories: 180, avgHr: 102, date: '2026-07-20', distanceKm: 3.1 },
    { sk: 'ACTIVITY#2026-07-18', name: 'Intervals', calories: 490, avgHr: 165, date: '2026-07-18', distanceKm: 5.0 },
    { sk: 'ACTIVITY#2026-07-16', name: 'Pool Swim', calories: 340, avgHr: 128, date: '2026-07-16', distanceKm: 1.8 },
    { sk: 'ACTIVITY#2026-07-14', name: 'Tempo Run', calories: 450, avgHr: 156, date: '2026-07-14', distanceKm: 7.2 },
    { sk: 'ACTIVITY#2026-07-12', name: 'Gym Strength', calories: 280, avgHr: 118, date: '2026-07-12', distanceKm: null },
  ],
  explainability: {
    primary_factor: "HRV Recovery & Balanced Strain",
    resting_hr_delta: "-2 bpm vs baseline",
    sleep_debt: "0.2 hrs",
    training_load_7d: "Optimal Strain Band",
    bedrock_rationale: "Bedrock Claude 3.5 Sonnet analysis indicates minimal autonomic stress."
  }
};

export const WARNING_STATE: RecoveryData = {
  dataSource: 'MOCK_FALLBACK',
  member: {
    memberId: 'ENT000122',
    firstName: 'Marnus',
    surname: 'Nieman',
    injury: 'Patellar Tendonitis (Stage 2 Strain)',
  },
  recovery_score: 48.2,
  readiness_score: 42.0,
  recovery_stage: 3,
  recovery_trend: "Elevated Fatigue",
  setback_probability: 0.62,
  recommended_activity: "Active Mobility & Rest",
  duration_minutes: 15,
  intensity: "Very Low",
  vo2_max_baseline: 38.5,
  vo2_max_current: 33.1,
  confidence: 0.89,
  ai_summary: "High cardiovascular fatigue detected. Cardiac drift risk is elevated.",
  ai_coaching_message: "Focus on low-strain active recovery. High intensity today increases setback risk by 62%.",
  recentActivities: [
    { sk: 'ACTIVITY#2026-07-24', name: 'Heavy HIIT Run', calories: 610, avgHr: 178, date: '2026-07-24', distanceKm: 8.0 },
    { sk: 'ACTIVITY#2026-07-23', name: 'Leg Day Strength', calories: 420, avgHr: 152, date: '2026-07-23', distanceKm: null },
    { sk: 'ACTIVITY#2026-07-21', name: 'Threshold Cycling', calories: 680, avgHr: 164, date: '2026-07-21', distanceKm: 24.0 },
    { sk: 'ACTIVITY#2026-07-19', name: '5km Sprint', calories: 380, avgHr: 171, date: '2026-07-19', distanceKm: 5.0 },
  ],
  explainability: {
    primary_factor: "Elevated Resting HR & Accumulated Load",
    resting_hr_delta: "+7 bpm vs baseline",
    sleep_debt: "1.8 hrs",
    training_load_7d: "High (Overreaching Threshold)",
    bedrock_rationale: "Bedrock Claude 3.5 Sonnet flagged sympathetic tone elevation."
  }
};

export const MOCK_SIMULATION_RESULT = {
  proposed_activity: "5 km Run",
  risk_level: "HIGH",
  safer_alternative: "20-minute Light Jog or Walk",
  ai_reasoning: "Attempting a 5 km run with current elevated heart rate increases injury risk by 45%."
};

export type RecoveryState = RecoveryData;
export const INITIAL_RECOVERY_STATE = OPTIMAL_STATE;