// src/screens/DashboardScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { OPTIMAL_STATE, RecoveryData, ActivityItem, RecoveryGoal } from '../mockData';
import { fetchDashboardData, submitCheckIn, submitExerciseLog, generatePlan, updateRecoveryGoal } from '../api';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Sparkles, 
  Activity, 
  ClipboardCheck,
  Zap,
  Moon,
  Heart,
  LogOut,
  User,
  Plus,
  Trophy,
  Flame,
  Target,
  CalendarDays,
  CheckCircle2,
  Circle,
  Bell,
  X,
} from 'lucide-react-native';
import TrendChart from '../components/TrendChart';
import DailyCheckInModal from '../components/DailyCheckInModal';
import VitalityScoreRing from '../components/VitalityScoreRing';
import LogExerciseDrawer, { ExerciseLogPayload } from '../components/LogExerciseDrawer';
import RecoveryGoalModal from '../components/RecoveryGoalModal';

type CategoryType = 'Recovery' | 'Strain' | 'Sleep' | 'Heart' | 'AI Plan' | 'Profile';

// The headline fields arrive already formatted from api.ts, but plan blocks
// carry the backend's raw vocabulary ("very_low", "mobility").
const titleCase = (s: string) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const DAY_MS = 24 * 60 * 60 * 1000;

function activityProgress(activities: ActivityItem[] = []) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const dates = new Set(
    activities
      .map((activity) => activity.date)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  );
  const lastSeven = activities.filter((activity) => {
    const time = Date.parse(`${activity.date}T00:00:00Z`);
    return Number.isFinite(time) && time <= todayMs && time >= todayMs - 6 * DAY_MS;
  });

  // A streak remains active through the day after the last session, so a
  // member is not shown "0 days" first thing in the morning.
  let cursor = todayMs;
  if (!dates.has(new Date(cursor).toISOString().slice(0, 10))) cursor -= DAY_MS;
  let streakDays = 0;
  while (dates.has(new Date(cursor).toISOString().slice(0, 10))) {
    streakDays += 1;
    cursor -= DAY_MS;
  }

  const sessionTarget = lastSeven.length < 3 ? 3 : lastSeven.length < 5 ? 5 : 7;
  const latestActivityTime = activities
    .map((activity) => Date.parse(`${activity.date}T00:00:00Z`))
    .filter((time) => Number.isFinite(time) && time <= todayMs)
    .sort((a, b) => b - a)[0];
  return {
    streakDays,
    sessions: lastSeven.length,
    activeDays: new Set(lastSeven.map((activity) => activity.date)).size,
    minutes: Math.round(lastSeven.reduce((sum, activity) => sum + (activity.durationMin ?? 0), 0)),
    sessionTarget,
    daysSinceLastActivity:
      latestActivityTime == null ? null : Math.floor((todayMs - latestActivityTime) / DAY_MS),
  };
}

type ContextualNudge = {
  id: string;
  title: string;
  message: string;
  tone: 'warning' | 'encouraging' | 'info';
  action: 'checkin' | 'plan';
  actionLabel: string;
};

function contextualNudges(
  data: RecoveryData,
  progress: ReturnType<typeof activityProgress>,
): ContextualNudge[] {
  const nudges: ContextualNudge[] = [];
  const pain = data.planEnvelope?.anchor?.reported_pain;

  if (typeof pain === 'number' && pain >= 4) {
    nudges.push({
      id: 'pain-checkin',
      title: 'Your pain signal needs attention',
      message: `Your latest reported pain is ${pain}/10. Check in again before following the next session recommendation.`,
      tone: 'warning',
      action: 'checkin',
      actionLabel: 'Check in now',
    });
  } else if (data.setback_probability >= 0.4) {
    nudges.push({
      id: 'recovery-risk',
      title: 'Recovery signals favour less load',
      message: `The model currently assigns ${Math.round(data.setback_probability * 100)}% to Reduce. Update how you feel before progressing.`,
      tone: 'warning',
      action: 'checkin',
      actionLabel: 'Update check-in',
    });
  }

  if (progress.sessions === 0) {
    nudges.push({
      id: 'restart-plan',
      title: 'Restart with the plan, not guesswork',
      message:
        progress.daysSinceLastActivity == null
          ? 'No recent session is recorded. Review your safe starting session when you are ready.'
          : `It has been ${progress.daysSinceLastActivity} ${progress.daysSinceLastActivity === 1 ? 'day' : 'days'} since your last recorded session. Review the current plan before restarting.`,
      tone: 'info',
      action: 'plan',
      actionLabel: 'View safe plan',
    });
  } else if (progress.sessionTarget - progress.sessions === 1) {
    nudges.push({
      id: `milestone-${progress.sessionTarget}`,
      title: 'One session from your next milestone',
      message: `Complete one more planned session to reach ${progress.sessionTarget} this week—only if today’s recovery recommendation supports it.`,
      tone: 'encouraging',
      action: 'plan',
      actionLabel: 'View today’s plan',
    });
  } else if (progress.streakDays >= 3) {
    nudges.push({
      id: 'streak',
      title: `${progress.streakDays}-day consistency streak`,
      message: 'Consistency is building. Keep the next session inside the current duration and intensity limits.',
      tone: 'encouraging',
      action: 'plan',
      actionLabel: 'Review limits',
    });
  }

  if (
    nudges.length < 2 &&
    data.vo2_predicted_change != null &&
    data.vo2_predicted_change > 0
  ) {
    nudges.push({
      id: 'vo2-outlook',
      title: 'Your VO₂ outlook has positive momentum',
      message: `The four-session outlook is +${data.vo2_predicted_change} mL/kg/min. Consistent, recovery-appropriate sessions give you the best chance of following that direction.`,
      tone: 'info',
      action: 'plan',
      actionLabel: 'See progression',
    });
  }

  return nudges.slice(0, 2);
}

function recoveryGoalProgress(data: RecoveryData) {
  const goal = data.member?.recoveryGoalDetails;
  if (!goal) return null;
  const matchingActivities = (data.recentActivities ?? []).filter((activity) => {
    if (!goal.activity) return true;
    const name = activity.name.toLowerCase();
    return (
      (goal.activity === 'walk' && name.includes('walk')) ||
      (goal.activity === 'run' && (name.includes('run') || name.includes('jog'))) ||
      (goal.activity === 'swim' && name.includes('swim'))
    );
  });
  const current =
    goal.type === 'distance'
      ? Math.max(0, ...matchingActivities.map((activity) => activity.distanceKm ?? 0))
      : goal.type === 'duration'
        ? Math.max(0, ...matchingActivities.map((activity) => activity.durationMin ?? 0))
        : (data.vo2ReadingCount ?? 0) > 0
          ? data.vo2_max_current
          : 0;
  return {
    goal,
    current,
    percent: Math.min(100, Math.round((current / goal.target) * 100)),
    achieved: current >= goal.target,
  };
}

function fourWeekOverview(data: RecoveryData, progress: ReturnType<typeof activityProgress>) {
  const activeDays = (data.weekPlan ?? []).filter(
    (day) => day.activity !== 'rest' && day.durationMinutes > 0,
  );
  const weekMinutes = activeDays.reduce((sum, day) => sum + day.durationMinutes, 0);
  const permitted = data.planEnvelope?.allowed_activities.map(titleCase).join(', ');
  const plannedSessions = activeDays.length;
  const completionTarget = plannedSessions ? Math.max(1, Math.ceil(plannedSessions * 0.75)) : 0;
  const completionMet = progress.sessions >= completionTarget;
  const pain = data.planEnvelope?.anchor?.reported_pain;
  const painMet = typeof pain === 'number' && pain <= 3;
  const readinessMet = data.recovery_label !== 'REDUCE';
  const riskMet = data.setback_probability < 0.4;
  const vo2Met = data.vo2_predicted_change == null || data.vo2_predicted_change >= 0;
  const week2Eligible = completionMet && painMet && readinessMet;
  const week3Eligible = week2Eligible && riskMet && vo2Met;

  return [
    {
      week: 1,
      title: 'Current validated plan',
      detail: activeDays.length
        ? `${activeDays.length} movement ${activeDays.length === 1 ? 'day' : 'days'} · ${weekMinutes} planned minutes`
        : 'Recovery week · no training load currently prescribed',
      status: 'CURRENT',
      checks: plannedSessions
        ? [
            {
              met: completionMet,
              label: `${Math.min(progress.sessions, completionTarget)} of ${completionTarget} sessions completed`,
            },
          ]
        : [{ met: true, label: 'Recovery week acknowledged' }],
    },
    {
      week: 2,
      title: 'Consistency checkpoint',
      detail: week2Eligible
        ? 'Current signals support generating the next validated week.'
        : 'Complete the gates below before training load can progress.',
      status: week2Eligible ? 'ELIGIBLE' : 'LOCKED',
      checks: [
        {
          met: completionMet,
          label: plannedSessions
            ? `Complete at least ${completionTarget} of ${plannedSessions} planned sessions`
            : 'Follow the prescribed recovery week',
        },
        {
          met: painMet,
          label: typeof pain === 'number' ? `Pain remains at or below 3/10 · now ${pain}/10` : 'Submit a check-in to confirm pain ≤ 3/10',
        },
        { met: readinessMet, label: `Readiness is Maintain or Progress · now ${titleCase(data.recovery_label || 'Unknown')}` },
      ],
    },
    {
      week: 3,
      title: 'Activity development',
      detail: week3Eligible
        ? `Eligible for reassessment within supported activities: ${permitted || 'next validated options'}.`
        : 'Progression remains gated by recovery risk and aerobic direction.',
      status: week3Eligible ? 'ELIGIBLE' : 'LOCKED',
      checks: [
        { met: week2Eligible, label: 'Week 2 gates remain satisfied' },
        {
          met: riskMet,
          label: `Setback risk below 40% · now ${Math.round(data.setback_probability * 100)}%`,
        },
        {
          met: vo2Met,
          label:
            data.vo2_predicted_change == null
              ? 'No declining VO₂ forecast detected'
              : `VO₂ outlook stable or improving · ${data.vo2_predicted_change >= 0 ? '+' : ''}${data.vo2_predicted_change}`,
        },
      ],
    },
    {
      week: 4,
      title: 'Consolidate and reassess VO₂',
      detail:
        data.vo2_forecast_4_weeks != null
          ? `Compare a new measurement with the current ${data.vo2_max_current} mL/kg/min baseline and the ${data.vo2_forecast_4_weeks} model outlook.`
          : 'Capture a new VO₂ estimate and rebuild the next progression phase.',
      status: 'REASSESS',
      checks: [
        { met: false, label: 'Complete the newly validated sessions' },
        { met: false, label: 'Capture a new VO₂ measurement' },
        { met: false, label: 'Generate the next recovery phase' },
      ],
    },
  ];
}

/**
 * One label/value line in the profile. Renders nothing at all when the value
 * is absent — a member record that lacks a field should show a shorter list,
 * not a list padded with dashes that read like missing data.
 */
function ProfileRow({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string | number | null;
  tone?: 'good' | 'bad';
}) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!text.trim() || text === 'undefined') return null;
  return (
    <View style={styles.explainRow}>
      <Text style={styles.explainLabel}>{label}</Text>
      <Text
        style={[
          styles.explainVal,
          tone === 'good' && { color: '#10B981' },
          tone === 'bad' && { color: '#DC2626' },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export default function DashboardScreen({ navigation, route }: any) {
  const entityNumber = route?.params?.entityNumber || 'ENT000122';
  const [data, setData] = useState<RecoveryData>(route?.params?.initialData || OPTIMAL_STATE);
  const [activeCategory, setActiveCategory] = useState<CategoryType>('Recovery');
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [logDrawerVisible, setLogDrawerVisible] = useState(false);
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [dismissedNudges, setDismissedNudges] = useState<string[]>([]);

  // "Optimal" vs "at risk" is derived directly from the data
  const isOptimal = data.setback_probability < 0.4;
  const m = data.member;

  // 36% of members have a single VO2 reading, which makes baseline and current
  // the same number — a comparison there reads as broken rather than flat.
  const hasVo2Comparison =
    (data.vo2ReadingCount ?? 0) >= 2 && data.vo2BaselineDate !== data.vo2CurrentDate;
  const vo2Delta = Math.round((data.vo2_max_current - data.vo2_max_baseline) * 10) / 10;
  const recommendationProbabilities = (['REDUCE', 'MAINTAIN', 'PROGRESS'] as const)
    .map((label) => ({
      label,
      value: data.model_probabilities?.[label],
    }))
    .filter((item): item is { label: 'REDUCE' | 'MAINTAIN' | 'PROGRESS'; value: number } =>
      typeof item.value === 'number',
    )
    .sort((a, b) => b.value - a.value);
  const secondaryRecommendations = recommendationProbabilities
    .filter(({ label }) => label !== data.recovery_label)
    .slice(0, 2);
  const progress = activityProgress(data.recentActivities);
  const nudges = contextualNudges(data, progress).filter(
    (nudge) => !dismissedNudges.includes(nudge.id),
  );
  const progressionOverview = fourWeekOverview(data, progress);
  const goalProgress = recoveryGoalProgress(data);
  const hasValidatedGeminiRationale =
    data.coachSource === 'gemini' && data.planSource === 'gemini';
  const planRationale = hasValidatedGeminiRationale
    ? data.explainability.bedrock_rationale
    : data.exercisePlan
      ? `${titleCase(data.recovery_label || 'Maintain')} was the readiness model’s strongest outcome. ` +
        `${data.explainability.primary_factor} was the leading signal, so the rules-based plan keeps the session ` +
        `within ${data.planEnvelope?.max_total_minutes ?? data.duration_minutes} minutes at no more than ` +
        `${titleCase(data.planEnvelope?.max_intensity ?? data.intensity)} intensity.`
      : null;

  // If Login didn't pass data (e.g. deep link during dev), fetch it live
  useEffect(() => {
    if (!route?.params?.initialData) {
      fetchDashboardData(entityNumber).then(setData).catch(() => {});
    }
  }, [entityNumber]);

  // Refetch whenever this screen regains focus (e.g. returning from Simulator)
  useEffect(
    () => navigation.addListener('focus', () => {
      fetchDashboardData(entityNumber).then(setData).catch(() => {});
    }),
    [navigation, entityNumber],
  );

  const handleLogExerciseSubmit = async (payload: ExerciseLogPayload) => {
    await submitExerciseLog(entityNumber, payload);
    fetchDashboardData(entityNumber).then(setData).catch(() => {});
  };

  // Plan generation is the one action that spends an LLM request, so it is
  // never triggered by mount or focus — only by the button on the AI Plan tab.
  const [generating, setGenerating] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const onGeneratePlan = async () => {
    setGenerating(true);
    setPlanError(null);
    const result = await generatePlan(entityNumber);
    if (result.ok) {
      // Re-reading the dashboard costs nothing: it serves the prediction the
      // call above just stored, so the plan appears without a second request.
      const fresh = await fetchDashboardData(entityNumber).catch(() => null);
      if (fresh) setData(fresh);
    } else {
      setPlanError('Could not reach the plan service. Your previous plan is unchanged.');
    }
    setGenerating(false);
  };

  const categories = [
    { id: 'Recovery', label: 'Recovery', color: '#E11082', Icon: Activity },
    { id: 'Strain', label: 'Strain', color: '#00A3E0', Icon: Zap },
    { id: 'Sleep', label: 'Sleep', color: '#8B5CF6', Icon: Moon },
    { id: 'Heart', label: 'Heart', color: '#10B981', Icon: Heart },
    { id: 'AI Plan', label: 'AI Plan', color: '#F59E0B', Icon: Sparkles },
    { id: 'Profile', label: 'Profile', color: '#6366F1', Icon: User },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>

        {/* STREAMLINED TOP HEADER */}
        <View style={styles.topHeaderRow}>
          <View style={styles.brandContainer}>
            <View style={styles.brandIconBox}>
              <Activity size={20} color="#FFF" />
            </View>
            <View>
              <View style={styles.brandTitleRow}>
                <Text style={styles.appTitle}>PulseGuard</Text>
                
                {/* LIVE vs MOCK BADGE INLINED */}
                <View
                  style={[
                    styles.sourceBadge,
                    {
                      backgroundColor: data.dataSource === 'LIVE_API' ? '#DCFCE7' : '#FEF3C7',
                      borderColor: data.dataSource === 'LIVE_API' ? '#16A34A' : '#D97706',
                      marginLeft: 8,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: data.dataSource === 'LIVE_API' ? '#16A34A' : '#D97706' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.sourceBadgeText,
                      { color: data.dataSource === 'LIVE_API' ? '#15803D' : '#B45309' },
                    ]}
                  >
                    {data.dataSource === 'LIVE_API' ? 'LIVE' : 'MOCK'}
                  </Text>
                </View>
              </View>
              <Text style={styles.subTitle}>Entity: {entityNumber} · Biometric Core</Text>
            </View>
          </View>

          <TouchableOpacity 
            style={styles.exitBtn} 
            onPress={() => navigation.replace('Login')}
          >
            <LogOut size={16} color="#DC2626" />
            <Text style={styles.exitBtnText}>Exit</Text>
          </TouchableOpacity>
        </View>

        {/* MAIN ACTION TOOLBAR (What-If AI & Check-In) */}
        <View style={styles.actionToolbar}>
          <TouchableOpacity 
            style={styles.toolbarBtnPrimary} 
            onPress={() => navigation.navigate('Simulator', { entityNumber })}
          >
            <Sparkles size={16} color="#FFF" />
            <Text style={styles.toolbarBtnPrimaryText}>What-If AI Simulator</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.toolbarBtnSecondary} 
            onPress={() => setCheckInVisible(true)}
          >
            <ClipboardCheck size={16} color="#002B49" />
            <Text style={styles.toolbarBtnSecondaryText}>Daily Check-In</Text>
          </TouchableOpacity>
        </View>

        {/* MOCK WEARABLE SYNC BANNER */}
        <View style={styles.syncBanner}>
          <View style={styles.syncDot} />
          <Text style={styles.syncText}>
            {data.lastReadingDate
              ? `Wearable data · last reading ${data.lastReadingDate}`
              : 'Garmin Forerunner 955 · Synced 2m ago'}
          </Text>
        </View>

        {/* INTERACTIVE VITALITY CATEGORY BUBBLES */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bubbleContainer}>
          {categories.map((cat) => {
            const isActive = activeCategory === cat.id;
            const CategoryIcon = cat.Icon;
            return (
              <TouchableOpacity 
                key={cat.id} 
                style={styles.bubbleItem}
                onPress={() => setActiveCategory(cat.id as CategoryType)}
                activeOpacity={0.7}
              >
                <View 
                  style={[
                    styles.bubbleCircle, 
                    isActive ? { backgroundColor: cat.color, borderColor: cat.color } : { backgroundColor: '#FFF', borderColor: '#E2E8F0' }
                  ]}
                >
                  <CategoryIcon size={20} color={isActive ? '#FFF' : cat.color} />
                </View>
                <Text style={[styles.bubbleLabel, isActive && { color: '#002B49', fontWeight: '800' }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* HEADER */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>PulseGuard AI</Text>
            <Text style={styles.headerSub}>Active Focus: <Text style={{ color: '#E11082', fontWeight: '800' }}>{activeCategory}</Text></Text>
          </View>
          
          <View style={styles.headerActions}>
            <View style={[styles.statusChip, { backgroundColor: isOptimal ? '#DCFCE7' : '#FEE2E2' }]}>
              {isOptimal ? <ShieldCheck size={14} color="#16A34A" /> : <AlertTriangle size={14} color="#DC2626" />}
              <Text style={[styles.statusChipText, { color: isOptimal ? '#16A34A' : '#DC2626' }]}>
                {data.recovery_trend}
              </Text>
            </View>
          </View>
        </View>

        {/* DYNAMIC CATEGORY CONTENT */}

        {/* 1. RECOVERY VIEW */}
        {activeCategory === 'Recovery' && (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View style={[styles.statusChip, { backgroundColor: isOptimal ? '#E11082' : '#DC2626', marginBottom: 8 }]}>
                  <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>
                    NEXT SESSION RECOMMENDATION
                  </Text>
                </View>
              </View>

              <VitalityScoreRing
                score={data.recovery_score}
                label={data.recovery_label}
                isOptimal={isOptimal}
              />
              {secondaryRecommendations.length > 0 && (
                <View style={styles.secondaryOutcomeRow}>
                  {secondaryRecommendations.map(({ label, value }) => {
                    const color =
                      label === 'REDUCE' ? '#DC2626' : label === 'PROGRESS' ? '#16A34A' : '#D97706';
                    const background =
                      label === 'REDUCE' ? '#FEF2F2' : label === 'PROGRESS' ? '#F0FDF4' : '#FFFBEB';
                    const copy =
                      label === 'REDUCE'
                        ? 'Reduce activity signal'
                        : label === 'PROGRESS'
                          ? 'Progress potential'
                          : 'Maintain current load';
                    return (
                      <View
                        key={label}
                        style={[styles.secondaryOutcome, { backgroundColor: background }]}
                      >
                        <Text style={[styles.secondaryOutcomeValue, { color }]}>
                          {Math.round(value * 100)}%
                        </Text>
                        <Text style={styles.secondaryOutcomeLabel}>{titleCase(label)}</Text>
                        <Text style={styles.secondaryOutcomeCopy}>{copy}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <Text style={styles.outcomeHierarchyNote}>
                The ring shows the most likely recommendation. The other model outcomes are shown below.
              </Text>
              <Text style={styles.aiSummary}>{data.ai_summary}</Text>
              <View style={styles.confidenceExplanation}>
                <Text style={styles.confidenceTitle}>
                  Why {Math.round(data.recovery_score)}%?
                </Text>
                <Text style={styles.confidenceBody}>
                  The model compared all three options using your recent health and activity signals.
                  {' '}{titleCase(data.recovery_label || 'Maintain')} received the highest estimated likelihood.
                </Text>
                <View style={styles.signalSummary}>
                  <Text style={styles.signalSummaryTitle}>Signals behind this recommendation</Text>
                  <View style={styles.signalRow}>
                    <Text style={styles.signalLabel}>Most influential</Text>
                    <Text style={styles.signalValue}>{data.explainability.primary_factor}</Text>
                  </View>
                  <View style={styles.signalRow}>
                    <Text style={styles.signalLabel}>Resting heart rate</Text>
                    <Text style={styles.signalValue}>{data.explainability.resting_hr_delta}</Text>
                  </View>
                  <View style={styles.signalRow}>
                    <Text style={styles.signalLabel}>Sleep shortfall</Text>
                    <Text style={styles.signalValue}>{data.explainability.sleep_debt}</Text>
                  </View>
                  <View style={[styles.signalRow, styles.signalRowLast]}>
                    <Text style={styles.signalLabel}>Recent training</Text>
                    <Text style={styles.signalValue}>{data.explainability.training_load_7d}</Text>
                  </View>
                </View>
                <Text style={styles.confidenceNote}>
                  These are recommendation probabilities, not guarantees of improvement, injury, or an overall health score.
                </Text>
              </View>
            </View>

            {nudges.length > 0 && (
              <View style={styles.card}>
                <View style={styles.nudgeHeader}>
                  <View style={styles.cardHeaderRow}>
                    <Bell size={17} color="#E11082" />
                    <Text style={[styles.cardTitle, { marginLeft: 6 }]}>FOR YOU TODAY</Text>
                  </View>
                  <Text style={styles.nudgeContextLabel}>BASED ON YOUR LATEST DATA</Text>
                </View>

                {nudges.map((nudge) => {
                  const toneColor =
                    nudge.tone === 'warning'
                      ? '#DC2626'
                      : nudge.tone === 'encouraging'
                        ? '#16A34A'
                        : '#0284C7';
                  const toneBackground =
                    nudge.tone === 'warning'
                      ? '#FEF2F2'
                      : nudge.tone === 'encouraging'
                        ? '#F0FDF4'
                        : '#F0F9FF';
                  return (
                    <View
                      key={nudge.id}
                      style={[styles.nudgeBox, { backgroundColor: toneBackground }]}
                    >
                      <View style={styles.nudgeTitleRow}>
                        <Text style={[styles.nudgeTitle, { color: toneColor }]}>{nudge.title}</Text>
                        <TouchableOpacity
                          accessibilityLabel={`Dismiss ${nudge.title}`}
                          onPress={() =>
                            setDismissedNudges((current) => [...current, nudge.id])
                          }
                          style={styles.nudgeDismiss}
                        >
                          <X size={14} color="#94A3B8" />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.nudgeMessage}>{nudge.message}</Text>
                      <TouchableOpacity
                        style={styles.nudgeAction}
                        onPress={() =>
                          nudge.action === 'checkin'
                            ? setCheckInVisible(true)
                            : setActiveCategory('AI Plan')
                        }
                      >
                        <Text style={[styles.nudgeActionText, { color: toneColor }]}>
                          {nudge.actionLabel} →
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.goalHeader}>
                <View style={styles.cardHeaderRow}>
                  <Target size={17} color="#E11082" />
                  <Text style={[styles.cardTitle, { marginLeft: 6 }]}>RECOVERY GOAL</Text>
                </View>
                {goalProgress?.achieved && <Text style={styles.goalAchievedBadge}>ACHIEVED</Text>}
              </View>

              {goalProgress ? (
                <>
                  <Text style={styles.goalTitle}>{data.member?.recoveryGoal}</Text>
                  <View style={styles.goalValues}>
                    <Text style={styles.goalCurrent}>
                      {Math.round(goalProgress.current * 10) / 10}{' '}
                      <Text style={styles.goalUnit}>{goalProgress.goal.unit}</Text>
                    </Text>
                    <Text style={styles.goalTarget}>
                      Target {goalProgress.goal.target} {goalProgress.goal.unit}
                    </Text>
                  </View>
                  <View style={styles.goalTrack}>
                    <View style={[styles.goalFill, { width: `${goalProgress.percent}%` }]} />
                  </View>
                  <Text style={styles.goalProgressText}>
                    {goalProgress.achieved
                      ? 'Goal reached using recorded evidence. Your next goal will still be subject to current recovery limits.'
                      : `${goalProgress.percent}% complete · based on your best recent ${
                          goalProgress.goal.type === 'vo2' ? 'measured VO₂ value' : 'matching activity'
                        }`}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.goalTitle}>
                    {data.member?.recoveryGoal || 'Choose a measurable recovery goal'}
                  </Text>
                  <Text style={styles.goalProgressText}>
                    This profile does not yet have a measurable target. Add one to track progress from recorded activities or VO₂ readings.
                  </Text>
                </>
              )}

              <TouchableOpacity style={styles.goalAction} onPress={() => setGoalModalVisible(true)}>
                <Text style={styles.goalActionText}>
                  {goalProgress?.achieved ? 'Choose next goal' : goalProgress ? 'Change goal' : 'Set measurable goal'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <View style={styles.progressHeader}>
                <View style={styles.cardHeaderRow}>
                  <Trophy size={17} color="#D97706" />
                  <Text style={[styles.cardTitle, { marginLeft: 6 }]}>YOUR PROGRESS</Text>
                </View>
                <Text style={styles.progressPeriod}>LAST 7 DAYS</Text>
              </View>

              <View style={styles.progressGrid}>
                <View style={styles.progressMetric}>
                  <Flame size={18} color="#E11082" />
                  <Text style={styles.progressValue}>{progress.streakDays}</Text>
                  <Text style={styles.progressLabel}>day streak</Text>
                </View>
                <View style={styles.progressMetric}>
                  <Activity size={18} color="#00A3E0" />
                  <Text style={styles.progressValue}>{progress.sessions}</Text>
                  <Text style={styles.progressLabel}>sessions</Text>
                </View>
                <View style={styles.progressMetric}>
                  <Target size={18} color="#10B981" />
                  <Text style={styles.progressValue}>{progress.minutes}</Text>
                  <Text style={styles.progressLabel}>active min</Text>
                </View>
              </View>

              <View style={styles.milestoneBox}>
                <View style={styles.milestoneCopy}>
                  <Text style={styles.milestoneTitle}>
                    {progress.sessions >= 7 ? 'Weekly milestone achieved!' : 'Next milestone'}
                  </Text>
                  <Text style={styles.milestoneText}>
                    {progress.sessions >= 7
                      ? `${progress.sessions} sessions across ${progress.activeDays} active days`
                      : `${progress.sessionTarget - progress.sessions} more ${
                          progress.sessionTarget - progress.sessions === 1 ? 'session' : 'sessions'
                        } to reach ${progress.sessionTarget} this week`}
                  </Text>
                </View>
                <Text style={styles.milestoneCount}>
                  {Math.min(progress.sessions, progress.sessionTarget)}/{progress.sessionTarget}
                </Text>
              </View>
              <View style={styles.milestoneTrack}>
                <View
                  style={[
                    styles.milestoneFill,
                    { width: `${Math.min(100, (progress.sessions / progress.sessionTarget) * 100)}%` },
                  ]}
                />
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={16} color="#002B49" />
                <Text style={[styles.cardTitle, { marginLeft: 6 }]}>7-DAY VO₂ MAX TREND</Text>
              </View>

              <TrendChart isOptimal={isOptimal} history={data.vo2_trend} />
              <View style={styles.divider} />

              {/* VO2 is measured history, not the 7-day line above it, and the
                  two readings can be months apart — so it is labelled with its
                  own dates rather than inheriting "7 Days Ago -> Today". */}
              {hasVo2Comparison ? (
                <>
                  <View style={styles.metricRow}>
                    <View style={styles.metricBox}>
                      <Text style={styles.subText}>Baseline VO₂ Max</Text>
                      <Text style={styles.metricVal}>{data.vo2_max_baseline}</Text>
                      {!!data.vo2BaselineDate && (
                        <Text style={styles.metricDate}>{data.vo2BaselineDate}</Text>
                      )}
                    </View>
                    <View style={styles.dividerVertical} />
                    <View style={styles.metricBox}>
                      <Text style={styles.subText}>Latest Measured</Text>
                      <Text style={[styles.metricVal, { color: isOptimal ? '#002B49' : '#E11082' }]}>
                        {data.vo2_max_current}
                      </Text>
                      {!!data.vo2CurrentDate && (
                        <Text style={styles.metricDate}>{data.vo2CurrentDate}</Text>
                      )}
                    </View>
                  </View>
                  <Text style={styles.metricNote}>
                    {vo2Delta === 0
                      ? 'No change between these two readings.'
                      : `${vo2Delta > 0 ? '+' : ''}${vo2Delta.toFixed(1)} mL/kg/min between these readings${
                          data.vo2ReadingCount ? ` · ${data.vo2ReadingCount} readings on file` : ''
                        }`}
                  </Text>
                </>
              ) : (
                <View style={styles.metricRow}>
                  <View style={styles.metricBox}>
                    <Text style={styles.subText}>VO₂ Max (single reading)</Text>
                    <Text style={styles.metricVal}>{data.vo2_max_current}</Text>
                    {!!data.vo2CurrentDate && (
                      <Text style={styles.metricDate}>{data.vo2CurrentDate}</Text>
                    )}
                    <Text style={styles.metricNote}>
                      Only one VO₂ reading is on file, so there is no baseline to compare against.
                    </Text>
                  </View>
                </View>
              )}

              {/* The model's actual contribution, kept separate from measured
                  history because only this line is a prediction. */}
              {data.vo2_forecast_4_weeks != null && (
                <View style={styles.vo2GoalBox}>
                  <View style={styles.vo2GoalHeader}>
                    <View>
                      <Text style={styles.vo2GoalEyebrow}>YOUR VO₂ GOAL</Text>
                      <Text style={styles.vo2GoalTitle}>Next 4 completed sessions</Text>
                    </View>
                    <Target size={20} color="#0369A1" />
                  </View>

                  <View style={styles.vo2GoalValues}>
                    <View style={styles.vo2GoalMetric}>
                      <Text style={styles.vo2GoalMetricLabel}>Latest measured</Text>
                      <Text style={styles.vo2GoalCurrent}>{data.vo2_max_current}</Text>
                    </View>
                    <Text style={styles.vo2GoalArrow}>→</Text>
                    <View style={[styles.vo2GoalMetric, { alignItems: 'flex-end' }]}>
                      <Text style={styles.vo2GoalMetricLabel}>Model outlook</Text>
                      <Text style={styles.vo2GoalTarget}>{data.vo2_forecast_4_weeks}</Text>
                    </View>
                  </View>

                  {data.vo2_predicted_change != null && (
                    <View
                      style={[
                        styles.vo2ChangePill,
                        {
                          backgroundColor:
                            data.vo2_predicted_change >= 0 ? '#DCFCE7' : '#FEF3C7',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.vo2ChangePillText,
                          { color: data.vo2_predicted_change >= 0 ? '#15803D' : '#A16207' },
                        ]}
                      >
                        {data.vo2_predicted_change >= 0 ? '+' : ''}
                        {data.vo2_predicted_change} mL/kg/min expected
                      </Text>
                    </View>
                  )}

                  <View style={styles.vo2PlanLink}>
                    <Text style={styles.vo2PlanLinkTitle}>How today supports this goal</Text>
                    <Text style={styles.vo2PlanLinkText}>
                      {data.duration_minutes === 0 || data.recommended_activity.toLowerCase() === 'rest'
                        ? 'Today is a recovery day. Protecting recovery now supports safer aerobic progression in your next sessions.'
                        : `Your ${data.duration_minutes}-minute ${data.intensity.toLowerCase()} ${data.recommended_activity.toLowerCase()} builds aerobic consistency while staying inside your current recovery limits.`}
                    </Text>
                  </View>
                  <Text style={styles.vo2GoalDisclaimer}>
                    This is a model outlook, not a guaranteed result or an achieved measurement.
                    It updates as new activity and recovery data arrives.
                  </Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* 2. STRAIN VIEW */}
        {activeCategory === 'Strain' && (
          <>
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Zap size={18} color="#00A3E0" />
                <Text style={[styles.cardTitle, { marginLeft: 6 }]}>CARDIO STRAIN & EXERTION</Text>
              </View>

              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.subText}>{data.strain ? 'Last Workout' : 'Target Strain'}</Text>
                  <Text style={styles.metricVal}>
                    {data.strain
                      ? (data.strain.lastWorkoutMin != null ? `${data.strain.lastWorkoutMin} min` : data.strain.lastWorkoutType)
                      : (isOptimal ? '12.5 - 14.0' : '5.0 - 7.5')}
                  </Text>
                </View>
                <View style={styles.dividerVertical} />
                <View style={styles.metricBox}>
                  <Text style={styles.subText}>{data.strain ? 'Recent Load' : 'Current Strain'}</Text>
                  <Text style={[styles.metricVal, { color: isOptimal ? '#00A3E0' : '#DC2626' }]}>
                    {data.strain ? `${data.strain.load7dMin} min` : (isOptimal ? '8.2' : '14.1 (High)')}
                  </Text>
                </View>
              </View>

              <Text style={styles.aiSummary}>
                {data.strain
                  ? `Last workout: ${data.strain.lastWorkoutType}` +
                    (data.strain.lastAvgHr != null ? `, avg HR ${data.strain.lastAvgHr} bpm` : '') +
                    `. ${data.strain.load7dMin} min across ${data.strain.workouts} recent sessions` +
                    (data.strain.avgRpe != null ? `, average RPE ${data.strain.avgRpe}/10.` : '.')
                  : isOptimal
                  ? 'Your cardiovascular system is primed for moderate to high exertion workouts today.'
                  : 'Strain accumulator exceeded safe limits relative to suppressed autonomic recovery.'}
              </Text>
            </View>

            {/* RECENT 7 ACTIVITIES BLOCK */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={18} color="#00A3E0" />
                <Text style={[styles.cardTitle, { marginLeft: 6 }]}>RECENT ACTIVITIES (LAST 7)</Text>
              </View>

              {data.recentActivities && data.recentActivities.length > 0 ? (
                <View style={styles.activityList}>
                  {data.recentActivities.slice(0, 7).map((act, index) => (
                    <View key={act.sk || index} style={styles.activityRow}>
                      <View style={styles.activityMain}>
                        <Text style={styles.activityName}>{act.name}</Text>
                        <Text style={styles.activityDate}>{act.date}</Text>
                      </View>
                      <View style={styles.activityMetrics}>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{act.calories != null ? `${act.calories} kcal` : '— kcal'}</Text>
                        </View>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{act.avgHr != null ? `${act.avgHr} bpm` : '— bpm'}</Text>
                        </View>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{act.distanceKm != null ? `${act.distanceKm} km` : '— km'}</Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.noActivityText}>No recent activities found for this user in database.</Text>
              )}
            </View>
          </>
        )}

        {/* 3. SLEEP VIEW */}
        {activeCategory === 'Sleep' && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Moon size={18} color="#8B5CF6" />
              <Text style={[styles.cardTitle, { marginLeft: 6 }]}>SLEEP ANALYSIS</Text>
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricBox}>
                <Text style={styles.subText}>Last Night</Text>
                <Text style={styles.metricVal}>
                  {data.sleep ? `${data.sleep.latestHours}h` : (isOptimal ? '7h 48m' : '5h 12m')}
                </Text>
              </View>
              <View style={styles.dividerVertical} />
              <View style={styles.metricBox}>
                <Text style={styles.subText}>{data.sleep ? `Avg (${data.sleep.nights} nights)` : 'Deep / REM Ratio'}</Text>
                <Text style={[styles.metricVal, { color: isOptimal ? '#8B5CF6' : '#DC2626' }]}>
                  {data.sleep ? `${data.sleep.avgHours}h` : (isOptimal ? '42%' : '18%')}
                </Text>
              </View>
            </View>

            <Text style={styles.aiSummary}>
              {data.sleep
                ? `Based on ${data.sleep.nights} recorded nights from your wearable. ` +
                  (data.sleep.avgHours >= 7
                    ? 'Sleep volume supports full recovery adaptation.'
                    : 'Sleep volume is below the 7h recovery threshold — prioritise an earlier night.')
                : isOptimal
                ? 'High restorative sleep efficiency recorded. REM cycles adequate for neuro-muscular recovery.'
                : 'Elevated nocturnal wake frequency detected. Autonomic nervous system did not enter deep recovery state.'}
            </Text>
          </View>
        )}

        {/* 4. HEART VIEW */}
        {activeCategory === 'Heart' && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Heart size={18} color="#10B981" />
              <Text style={[styles.cardTitle, { marginLeft: 6 }]}>CARDIOVASCULAR & HRV</Text>
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricBox}>
                <Text style={styles.subText}>Resting Heart Rate</Text>
                <Text style={styles.metricVal}>
                  {data.heart ? `${data.heart.restingHr} bpm` : (isOptimal ? '52 bpm' : '64 bpm')}
                </Text>
              </View>
              <View style={styles.dividerVertical} />
              <View style={styles.metricBox}>
                <Text style={styles.subText}>rMSSD (HRV)</Text>
                <Text style={[styles.metricVal, { color: isOptimal ? '#10B981' : '#DC2626' }]}>
                  {data.heart?.hrvMs != null ? `${data.heart.hrvMs} ms` : (isOptimal ? '68 ms' : '28 ms')}
                </Text>
              </View>
            </View>

            <Text style={styles.aiSummary}>
              {data.heart
                ? `Latest wearable reading: ${data.heart.restingHr} bpm resting` +
                  (data.heart.deltaVsAvg != null
                    ? `, ${data.heart.deltaVsAvg >= 0 ? '+' : ''}${data.heart.deltaVsAvg} bpm vs your recent average`
                    : '') +
                  (data.heart.hrvMs != null ? `. HRV (rMSSD) at ${data.heart.hrvMs} ms.` : '.')
                : isOptimal
                ? 'Parasympathetic tone is dominant. Heart rate variability is well within optimal baseline thresholds.'
                : 'Significant HRV depression observed (+12 bpm RHR elevation over 7-day baseline).'}
            </Text>
          </View>
        )}
      
        {/* PROFILE VIEW */}
        {activeCategory === 'Profile' && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <User size={18} color="#6366F1" />
              <Text style={[styles.cardTitle, { marginLeft: 6 }]}>MEMBER PROFILE & CLINICAL RECORD</Text>
            </View>

            <View style={styles.profileHeaderBox}>
              <Text style={styles.profileName}>
                {data.member?.firstName && data.member?.surname
                  ? `${data.member.firstName} ${data.member.surname}`
                  : `Member ${entityNumber}`}
              </Text>
              <Text style={styles.profileIdText}>Database Entity ID: {entityNumber}</Text>
            </View>

            {/* Membership chips, shown only when the record carries them */}
            {(!!m?.vitalityStatus || !!m?.age || !!m?.gender) && (
              <View style={styles.chipWrap}>
                {!!m?.vitalityStatus && (
                  <Text style={[styles.profileChip, styles.profileChipAccent]}>
                    {m.vitalityStatus}
                  </Text>
                )}
                {!!m?.age && <Text style={styles.profileChip}>{Math.round(m.age)} yrs</Text>}
                {!!m?.gender && <Text style={styles.profileChip}>{m.gender}</Text>}
                {!!m?.city && <Text style={styles.profileChip}>{m.city}</Text>}
              </View>
            )}

            <View style={styles.divider} />

            {/* Every row is conditional: an absent field is omitted rather than
                printed as a dash, so the record never implies data it lacks. */}
            <Text style={styles.profileSection}>RECOVERY</Text>
            <ProfileRow label="Goal" value={m?.recoveryGoal} />
            <ProfileRow label="Activity baseline" value={m?.activityBaseline} />
            <ProfileRow label="Recovery stage" value={m?.recoveryStageText ?? `Stage ${data.recovery_stage}`} />
            <ProfileRow label="Baseline VO₂ max" value={`${data.vo2_max_baseline} mL/kg/min`} />
            <ProfileRow label="Current VO₂ max" value={`${data.vo2_max_current} mL/kg/min`} />
            {data.vo2_forecast_4_weeks != null && (
              <ProfileRow
                label="VO₂ forecast (4 sessions)"
                value={`${data.vo2_forecast_4_weeks} mL/kg/min${
                  data.vo2_predicted_change != null
                    ? ` (${data.vo2_predicted_change >= 0 ? '+' : ''}${data.vo2_predicted_change})`
                    : ''
                }`}
              />
            )}

            <Text style={styles.profileSection}>CLINICAL RECORD</Text>
            <ProfileRow label="Condition" value={m?.conditionCategory} />
            <ProfileRow label="Diagnosis / event" value={m?.diagnosisOrEvent} />
            <ProfileRow label="Event type" value={m?.eventType} />
            <ProfileRow label="Event date" value={m?.eventDate} />
            <ProfileRow label="Severity" value={m?.severity} />
            <ProfileRow label="Medication impact" value={m?.medicationImpact} />
            <ProfileRow
              label="Intake pain score"
              value={m?.intakePainScore != null ? `${m.intakePainScore}/10` : undefined}
            />

            <Text style={styles.profileSection}>SAFETY FLAGS</Text>
            <ProfileRow
              label="Clinician cleared"
              value={m?.clinicianCleared}
              tone={String(m?.clinicianCleared).toLowerCase() === 'no' ? 'bad' : 'good'}
            />
            <ProfileRow
              label="Contraindication"
              value={m?.contraindicationFlag}
              tone={String(m?.contraindicationFlag).toLowerCase() === 'yes' ? 'bad' : 'good'}
            />
            <ProfileRow label="Mobility limitation" value={m?.mobilityLimitation} />
            <ProfileRow
              label="VO₂ risk band"
              value={m?.vo2RiskBand}
              tone={String(m?.vo2RiskBand).toLowerCase() === 'high' ? 'bad' : undefined}
            />
            <ProfileRow
              label="Active injury"
              value={m?.injury}
              tone={isOptimal ? 'good' : 'bad'}
            />

            {(!!m?.medicalAidPlan || !!m?.joinDate || !!m?.province) && (
              <>
                <Text style={styles.profileSection}>MEMBERSHIP</Text>
                <ProfileRow label="Plan" value={m?.medicalAidPlan} />
                <ProfileRow label="Province" value={m?.province} />
                <ProfileRow label="Member since" value={m?.joinDate} />
              </>
            )}
          </View>
        )}

        {/* 6. DEDICATED AI PLAN VIEW */}
        {activeCategory === 'AI Plan' && (
          <>
            {/* Header row: the Generate control is deliberately small and sits
                above the plan. Mount and focus never trigger it, so the LLM
                quota can only be spent by a deliberate press. */}
            <View style={styles.planHeaderRow}>
              <View style={styles.planHeaderText}>
                <Text style={styles.planHeaderTitle}>AI Session Plan</Text>
                <Text style={styles.planHeaderSub}>
                  {data.planSource === 'gemini'
                    ? 'Designed by Gemini · updates on every check-in'
                    : 'Tap Generate, or submit a check-in to build one'}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.generateBtnSm, generating && styles.generateBtnBusy]}
                onPress={onGeneratePlan}
                disabled={generating}
                activeOpacity={0.85}
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Sparkles size={13} color="#FFFFFF" />
                    <Text style={styles.generateBtnSmText}>
                      {data.planSource === 'gemini' ? 'Regenerate' : 'Generate'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {!!planError && <Text style={styles.planErrorText}>{planError}</Text>}

            {data.exercisePlan ? (
              <>
                {/* SESSION — the hero of this tab */}
                <View style={[styles.card, styles.sessionHero]}>
                  <View style={styles.sessionTopRow}>
                    <View style={styles.sessionBadge}>
                      <Sparkles size={11} color="#FDE68A" />
                      <Text style={styles.sessionBadgeText}>
                        {data.planSource === 'gemini' ? 'GEMINI DESIGNED' : 'MODEL DEFAULT'}
                      </Text>
                    </View>
                    {!!data.planEnvelope && (
                      <Text style={styles.readinessTag}>
                        {titleCase(data.planEnvelope.readiness)}
                      </Text>
                    )}
                  </View>

                  {!!data.exercisePlan.session_focus && (
                    <Text style={styles.sessionFocus}>{data.exercisePlan.session_focus}</Text>
                  )}

                  <View style={styles.sessionStatRow}>
                    <View>
                      <Text style={styles.sessionBigNum}>{data.exercisePlan.total_minutes}</Text>
                      <Text style={styles.sessionStatLabel}>MINUTES</Text>
                    </View>
                    <View style={styles.sessionStatDivider} />
                    <View>
                      <Text style={styles.sessionMedNum}>{data.exercisePlan.blocks.length}</Text>
                      <Text style={styles.sessionStatLabel}>PHASES</Text>
                    </View>
                    <View style={styles.sessionStatDivider} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessionMedNum}>{titleCase(data.intensity)}</Text>
                      <Text style={styles.sessionStatLabel}>PEAK INTENSITY</Text>
                    </View>
                  </View>

                  <View style={styles.sessionBox}>
                    {data.exercisePlan.blocks.map((block, index) => (
                      <View key={index} style={styles.blockRow}>
                        <View style={styles.blockRail}>
                          <View style={styles.blockDot} />
                          {index < data.exercisePlan!.blocks.length - 1 && (
                            <View style={styles.blockLine} />
                          )}
                        </View>
                        <View style={styles.blockBody}>
                          <Text style={styles.blockPhase}>{block.phase.toUpperCase()}</Text>
                          <Text style={styles.blockTitle}>
                            {block.minutes} min {titleCase(block.activity)}
                          </Text>
                          <View style={styles.chipRow}>
                            <Text style={styles.chip}>{titleCase(block.intensity)}</Text>
                            {!!block.target_rpe && (
                              <Text style={styles.chip}>RPE {block.target_rpe}</Text>
                            )}
                          </View>
                          {!!block.cue && <Text style={styles.blockCue}>{block.cue}</Text>}
                        </View>
                      </View>
                    ))}
                  </View>

                  {!!data.exercisePlan.stop_rules?.length && (
                    <View style={styles.stopBox}>
                      <Text style={styles.stopTitle}>STOP IMMEDIATELY IF</Text>
                      {data.exercisePlan.stop_rules.map((rule, index) => (
                        <Text key={index} style={styles.stopRule}>• {rule}</Text>
                      ))}
                    </View>
                  )}

                  {!!data.exercisePlan.progression_note && (
                    <Text style={styles.progressionNote}>{data.exercisePlan.progression_note}</Text>
                  )}
                </View>

                {/* SAFETY ENVELOPE — the AI designed inside limits the model
                    set, not around them. */}
                {!!data.planEnvelope && (
                  <View style={styles.card}>
                    <View style={styles.cardHeaderRow}>
                      <ShieldCheck size={16} color="#10B981" />
                      <Text style={[styles.cardTitle, { marginLeft: 6 }]}>MODEL SAFETY ENVELOPE</Text>
                    </View>
                    <Text style={styles.envelopeIntro}>
                      Limits set by the readiness model before the AI was asked. Any plan outside
                      them is rejected automatically.
                    </Text>

                    <View style={styles.envRow}>
                      <Text style={styles.envLabel}>Max duration</Text>
                      <Text style={styles.envVal}>{data.planEnvelope.max_total_minutes} min</Text>
                    </View>
                    <View style={styles.envRow}>
                      <Text style={styles.envLabel}>Max intensity</Text>
                      <Text style={styles.envVal}>{titleCase(data.planEnvelope.max_intensity)}</Text>
                    </View>
                    <View style={styles.envRow}>
                      <Text style={styles.envLabel}>Max exertion</Text>
                      <Text style={styles.envVal}>RPE {data.planEnvelope.max_rpe}</Text>
                    </View>
                    <View style={styles.envRow}>
                      <Text style={styles.envLabel}>Permitted</Text>
                      <Text style={styles.envVal}>
                        {data.planEnvelope.allowed_activities.map(titleCase).join(', ') || 'Rest only'}
                      </Text>
                    </View>
                    {!!data.planEnvelope.anchor?.last_completed_activity && (
                      <View style={styles.envRow}>
                        <Text style={styles.envLabel}>Anchored to</Text>
                        <Text style={styles.envVal}>
                          {data.planEnvelope.anchor.last_completed_minutes} min{' '}
                          {titleCase(data.planEnvelope.anchor.last_completed_activity)}
                        </Text>
                      </View>
                    )}

                    <Text style={styles.planSourceNote}>
                      {data.planSource === 'gemini'
                        ? '✓ This session passed every check above'
                        : data.planSource === 'rules'
                          ? '⚠ The AI plan failed a check — showing the deterministic plan'
                          : 'Deterministic plan — tap Generate for an AI-designed session'}
                    </Text>
                  </View>
                )}

                {/* PROVISIONAL WEEK */}
                {!!data.weekPlan?.length && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>THIS WEEK (PROVISIONAL)</Text>
                    <Text style={styles.weekNote}>
                      Day 1 follows today's model prediction. Days 2–7 are a provisional shape,
                      not a forecast, and are rebuilt each time the plan is regenerated.
                    </Text>
                    {data.weekPlan.map((day) => {
                      const resting = day.activity === 'rest' || day.durationMinutes === 0;
                      return (
                        <View key={day.day} style={styles.weekRow}>
                          <Text style={styles.weekDay}>Day {day.day}</Text>
                          <View style={styles.weekBody}>
                            <Text style={[styles.weekActivity, resting && styles.weekResting]}>
                              {resting
                                ? 'Rest'
                                : `${day.durationMinutes} min ${titleCase(day.activity)}`}
                            </Text>
                            {!!day.focus && !resting && (
                              <Text style={styles.weekFocus}>{day.focus}</Text>
                            )}
                          </View>
                          <Text style={styles.weekIntensity}>
                            {resting ? '—' : titleCase(day.intensity)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                <View style={styles.card}>
                  <View style={styles.progressionHeader}>
                    <View style={styles.cardHeaderRow}>
                      <CalendarDays size={17} color="#6366F1" />
                      <Text style={[styles.cardTitle, { marginLeft: 6 }]}>4-WEEK PROGRESSION</Text>
                    </View>
                    <Text style={styles.progressionAdaptive}>ADAPTIVE</Text>
                  </View>
                  <Text style={styles.progressionIntro}>
                    Progression is earned through plan completion and recovery signals. Meeting a
                    gate makes the next stage eligible for a new plan—it never increases load automatically.
                  </Text>

                  {progressionOverview.map((item, index) => (
                    <View key={item.week} style={styles.progressionRow}>
                      <View style={styles.progressionRail}>
                        <View
                          style={[
                            styles.progressionDot,
                            item.status === 'CURRENT' && styles.progressionDotCurrent,
                            item.status === 'ELIGIBLE' && styles.progressionDotEligible,
                          ]}
                        >
                          <Text
                            style={[
                              styles.progressionDotText,
                              item.status === 'CURRENT' && styles.progressionDotTextCurrent,
                              item.status === 'ELIGIBLE' && styles.progressionDotTextEligible,
                            ]}
                          >
                            {item.week}
                          </Text>
                        </View>
                        {index < progressionOverview.length - 1 && (
                          <View style={styles.progressionLine} />
                        )}
                      </View>
                      <View style={styles.progressionBody}>
                        <View style={styles.progressionTitleRow}>
                          <Text style={styles.progressionTitle}>{item.title}</Text>
                          <Text
                            style={[
                              styles.progressionStatus,
                              item.status === 'CURRENT' && styles.progressionStatusCurrent,
                              item.status === 'ELIGIBLE' && styles.progressionStatusEligible,
                            ]}
                          >
                            {item.status}
                          </Text>
                        </View>
                        <Text style={styles.progressionDetail}>{item.detail}</Text>
                        <View style={styles.gateList}>
                          {item.checks.map((check) => (
                            <View key={check.label} style={styles.gateRow}>
                              {check.met ? (
                                <CheckCircle2 size={13} color="#16A34A" />
                              ) : (
                                <Circle size={13} color="#CBD5E1" />
                              )}
                              <Text style={[styles.gateText, check.met && styles.gateTextMet]}>
                                {check.label}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  ))}

                  <View style={styles.progressionSafetyNote}>
                    <ShieldCheck size={14} color="#15803D" />
                    <Text style={styles.progressionSafetyText}>
                      Eligible means ready for reassessment. Only a newly validated plan can prescribe the next week.
                    </Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={[styles.card, styles.highlightCard]}>
                <View style={styles.cardHeaderRow}>
                  <Sparkles size={18} color="#E11082" />
                  <Text style={[styles.cardTitleLight, { marginLeft: 6 }]}>TODAY'S AI PRESCRIBED PLAN</Text>
                </View>
                <Text style={styles.planTitle}>{data.duration_minutes} min {data.recommended_activity}</Text>
                <Text style={styles.planSub}>Target Intensity: {data.intensity}</Text>
                <Text style={styles.coachingMsg}>"{data.ai_coaching_message}"</Text>
              </View>
            )}

            {!!planRationale && (
              <View style={styles.card}>
                <View style={styles.rationaleHeader}>
                  <View style={styles.cardHeaderRow}>
                    {hasValidatedGeminiRationale ? (
                      <Sparkles size={16} color="#6366F1" />
                    ) : (
                      <ShieldCheck size={16} color="#10B981" />
                    )}
                    <Text style={[styles.cardTitle, { marginLeft: 6 }]}>WHY THIS PLAN?</Text>
                  </View>
                  <Text
                    style={[
                      styles.rationaleSource,
                      hasValidatedGeminiRationale
                        ? styles.rationaleSourceGemini
                        : styles.rationaleSourceRules,
                    ]}
                  >
                    {hasValidatedGeminiRationale ? 'GEMINI · VALIDATED' : 'MODEL + SAFETY RULES'}
                  </Text>
                </View>
                <Text style={styles.rationaleText}>{planRationale}</Text>
                {!hasValidatedGeminiRationale && (
                  <Text style={styles.rationaleNote}>
                    {data.planSource === 'rules'
                      ? 'Gemini’s proposed plan was unavailable or did not pass validation, so the safe rules-based plan is shown.'
                      : 'Gemini was not used for this plan. This explanation comes from the model outcome and validated safety limits.'}
                  </Text>
                )}
              </View>
            )}
          </>
        )}

      </ScrollView>

      {/* PERSISTENT RIGHT-SIDE SLIDER TAB HANDLE */}
      <TouchableOpacity
        style={styles.sideTabHandle}
        onPress={() => setLogDrawerVisible(true)}
        activeOpacity={0.8}
      >
        <Plus size={18} color="#FFF" />
        <Text style={styles.sideTabHandleText}>LOG</Text>
      </TouchableOpacity>

      {/* SLIDING EXERCISE DRAWER */}
      <LogExerciseDrawer
        visible={logDrawerVisible}
        onClose={() => setLogDrawerVisible(false)}
        onSubmit={handleLogExerciseSubmit}
      />

      <RecoveryGoalModal
        visible={goalModalVisible}
        onClose={() => setGoalModalVisible(false)}
        currentGoal={data.member?.recoveryGoal}
        onSave={async (goal: RecoveryGoal, goalStatement: string) => {
          const result = await updateRecoveryGoal(entityNumber, goal, goalStatement);
          if (!result.updated) return false;
          const fresh = await fetchDashboardData(entityNumber).catch(() => null);
          if (fresh) setData(fresh);
          return true;
        }}
      />

      {/* DAILY CHECK-IN MODAL */}
      <DailyCheckInModal
        visible={checkInVisible}
        onClose={() => setCheckInVisible(false)}
        onSubmitCheckIn={async (hasSymptoms, details) => {
          // The backend re-runs both models on every check-in and returns the
          // fresh prediction, so render that. Previously this discarded the
          // response and swapped in a hardcoded OPTIMAL_STATE/WARNING_STATE,
          // which meant a live check-in displayed mock numbers.
          // refreshPlan: the member has just told the system how they feel, so
          // the AI session is rebuilt with it. This is the only place in the
          // app that spends a request without an explicit Generate press.
          const result = await submitCheckIn(
            entityNumber,
            { ...details, refreshPlan: true },
            data,
          );
          if (result.data) {
            setData(result.data);
            return;
          }
          // Unreachable backend: keep the member's real values rather than
          // inventing a new state, and let the next focus refetch correct it.
          setData((prev) => ({
            ...prev,
            dataSource: 'MOCK_FALLBACK',
          }));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F7F9' },
  contentContainer: { padding: 16, maxWidth: 430, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  
  syncBanner: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#E0F2FE', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#BAE6FD' },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#0284C7', marginRight: 6 },
  syncText: { fontSize: 11, fontWeight: '700', color: '#0369A1' },
  
  bubbleContainer: { flexDirection: 'row', marginBottom: 24, paddingVertical: 2 },
  bubbleItem: { alignItems: 'center', marginRight: 18 },
  bubbleCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginBottom: 8, ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 6 }, android: { elevation: 3 } }) },
  bubbleLabel: { fontSize: 11, fontWeight: '600', color: '#64748B' },
  
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#002B49', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontWeight: '600', color: '#64748B', marginTop: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  
  checkInBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 3 }, android: { elevation: 1 } }) },
  checkInBtnText: { fontSize: 12, fontWeight: '800', color: '#002B49', marginLeft: 6 },
  
  statusChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  statusChipText: { fontSize: 11, fontWeight: '800', marginLeft: 4 },
  
  card: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 20, 
    padding: 20, 
    marginBottom: 16, 
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...Platform.select({
      ios: { shadowColor: '#091E42', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 },
      android: { elevation: 4 }
    })
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 1 },
  cardTitleLight: { fontSize: 11, fontWeight: '800', color: 'rgba(255, 255, 255, 0.7)', letterSpacing: 1 },
  aiSummary: { fontSize: 14, color: '#334155', marginTop: 12, fontWeight: '500', lineHeight: 22 },
  secondaryOutcomeRow: {
    flexDirection: 'row',
    marginHorizontal: -4,
    marginTop: 12,
  },
  secondaryOutcome: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  secondaryOutcomeValue: { fontSize: 22, fontWeight: '900' },
  secondaryOutcomeLabel: { fontSize: 10, color: '#002B49', fontWeight: '900', marginTop: 2 },
  secondaryOutcomeCopy: {
    fontSize: 9,
    color: '#64748B',
    lineHeight: 13,
    textAlign: 'center',
    marginTop: 2,
  },
  outcomeHierarchyNote: {
    fontSize: 9,
    color: '#64748B',
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  confidenceExplanation: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  confidenceTitle: { fontSize: 13, fontWeight: '900', color: '#002B49' },
  confidenceBody: { fontSize: 12, color: '#475569', lineHeight: 18, marginTop: 5 },
  signalSummary: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  signalSummaryTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#64748B',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 9,
  },
  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 8,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  signalRowLast: { paddingBottom: 0, marginBottom: 0, borderBottomWidth: 0 },
  signalLabel: { flex: 1, fontSize: 11, color: '#64748B', fontWeight: '600' },
  signalValue: {
    flex: 1.4,
    fontSize: 11,
    color: '#002B49',
    fontWeight: '800',
    textAlign: 'right',
  },
  confidenceNote: { fontSize: 10, color: '#64748B', lineHeight: 15, marginTop: 3, fontStyle: 'italic' },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  progressPeriod: { fontSize: 9, color: '#94A3B8', fontWeight: '900', letterSpacing: 0.7 },
  progressGrid: { flexDirection: 'row', marginHorizontal: -4 },
  progressMetric: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  progressValue: { fontSize: 22, fontWeight: '900', color: '#002B49', marginTop: 4 },
  progressLabel: { fontSize: 10, color: '#64748B', fontWeight: '700', marginTop: 1 },
  milestoneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  milestoneCopy: { flex: 1, paddingRight: 12 },
  milestoneTitle: { fontSize: 12, fontWeight: '900', color: '#002B49' },
  milestoneText: { fontSize: 11, color: '#64748B', lineHeight: 16, marginTop: 2 },
  milestoneCount: { fontSize: 13, fontWeight: '900', color: '#E11082' },
  milestoneTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
    marginTop: 9,
  },
  milestoneFill: { height: '100%', borderRadius: 999, backgroundColor: '#E11082' },
  nudgeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 11,
  },
  nudgeContextLabel: { fontSize: 8, color: '#94A3B8', fontWeight: '900', letterSpacing: 0.5 },
  nudgeBox: { borderRadius: 13, padding: 13, marginTop: 8 },
  nudgeTitleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  nudgeTitle: { flex: 1, fontSize: 13, fontWeight: '900', paddingRight: 8 },
  nudgeDismiss: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -5,
    marginRight: -5,
  },
  nudgeMessage: { fontSize: 11, color: '#475569', lineHeight: 17, marginTop: 4 },
  nudgeAction: { alignSelf: 'flex-start', paddingTop: 9, paddingBottom: 1 },
  nudgeActionText: { fontSize: 11, fontWeight: '900' },
  goalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalAchievedBadge: {
    fontSize: 8,
    color: '#15803D',
    fontWeight: '900',
    letterSpacing: 0.7,
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  goalTitle: { fontSize: 16, color: '#002B49', fontWeight: '900', lineHeight: 22, marginTop: 12 },
  goalValues: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 13 },
  goalCurrent: { fontSize: 25, color: '#E11082', fontWeight: '900' },
  goalUnit: { fontSize: 11, color: '#64748B', fontWeight: '700' },
  goalTarget: { fontSize: 11, color: '#64748B', fontWeight: '800' },
  goalTrack: { height: 8, borderRadius: 99, backgroundColor: '#F1F5F9', overflow: 'hidden', marginTop: 9 },
  goalFill: { height: '100%', borderRadius: 99, backgroundColor: '#E11082' },
  goalProgressText: { fontSize: 10, color: '#64748B', lineHeight: 15, marginTop: 8 },
  goalAction: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#E11082',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    marginTop: 12,
  },
  goalActionText: { fontSize: 10, color: '#B60867', fontWeight: '900' },
  
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 8 },
  metricBox: { flex: 1, alignItems: 'center' },
  subText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  metricVal: { fontSize: 24, fontWeight: '900', color: '#002B49', marginTop: 4 },
  forecastBox: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#F0F9FF', borderWidth: 1, borderColor: '#BAE6FD', alignItems: 'center' },
  forecastLabel: { fontSize: 11, fontWeight: '900', color: '#0369A1', letterSpacing: 0.8 },
  forecastValue: { fontSize: 24, fontWeight: '900', color: '#002B49', marginTop: 5 },
  forecastChange: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  forecastDisclaimer: { fontSize: 11, color: '#64748B', marginTop: 6, fontStyle: 'italic' },
  vo2GoalBox: {
    marginTop: 18,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  vo2GoalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  vo2GoalEyebrow: { fontSize: 10, color: '#0369A1', fontWeight: '900', letterSpacing: 0.9 },
  vo2GoalTitle: { fontSize: 12, color: '#64748B', fontWeight: '600', marginTop: 2 },
  vo2GoalValues: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  vo2GoalMetric: { flex: 1 },
  vo2GoalMetricLabel: { fontSize: 10, color: '#64748B', fontWeight: '700' },
  vo2GoalCurrent: { fontSize: 27, color: '#002B49', fontWeight: '900', marginTop: 2 },
  vo2GoalTarget: { fontSize: 27, color: '#0369A1', fontWeight: '900', marginTop: 2 },
  vo2GoalArrow: { fontSize: 22, color: '#7DD3FC', fontWeight: '700', marginHorizontal: 12 },
  vo2ChangePill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginTop: 12,
  },
  vo2ChangePillText: { fontSize: 10, fontWeight: '900' },
  vo2PlanLink: {
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#BAE6FD',
  },
  vo2PlanLinkTitle: { fontSize: 11, color: '#002B49', fontWeight: '900' },
  vo2PlanLinkText: { fontSize: 11, color: '#475569', lineHeight: 17, marginTop: 3 },
  vo2GoalDisclaimer: {
    fontSize: 9,
    color: '#64748B',
    fontStyle: 'italic',
    lineHeight: 14,
    marginTop: 10,
  },
  
  highlightCard: { backgroundColor: '#002B49', borderColor: '#001A2C' },
  planTitle: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 8, letterSpacing: -0.5 },
  planSub: { fontSize: 13, fontWeight: '700', color: '#E11082', marginTop: 4 },
  coachingMsg: { fontSize: 14, fontStyle: 'italic', color: '#E2E8F0', marginTop: 12, lineHeight: 20 },

  // --- vo2 provenance (forecast styles already existed, unused, above) ---
  metricDate: { fontSize: 10, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
  metricNote: { fontSize: 11, color: '#64748B', marginTop: 10, textAlign: 'center', lineHeight: 16 },
  forecastRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 5 },

  // --- profile ---
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  profileChip: {
    fontSize: 11, fontWeight: '700', color: '#475569', backgroundColor: '#F1F5F9',
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 9, marginRight: 6, marginBottom: 6,
    overflow: 'hidden',
  },
  profileChipAccent: { color: '#FFFFFF', backgroundColor: '#6366F1' },
  profileSection: {
    fontSize: 10, fontWeight: '900', color: '#94A3B8', letterSpacing: 1,
    marginTop: 18, marginBottom: 4,
  },

  // --- AI Plan tab: compact header + generate control ---
  planHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14, paddingHorizontal: 2,
  },
  planHeaderText: { flex: 1, paddingRight: 12 },
  planHeaderTitle: { fontSize: 20, fontWeight: '900', color: '#002B49', letterSpacing: -0.4 },
  planHeaderSub: { fontSize: 11, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
  generateBtnSm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F59E0B', borderRadius: 999,
    paddingVertical: 9, paddingHorizontal: 14, minWidth: 104,
  },
  generateBtnBusy: { backgroundColor: '#FBBF24' },
  generateBtnSmText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginLeft: 6 },
  planErrorText: { fontSize: 12, color: '#DC2626', marginBottom: 12, fontWeight: '600' },
  rationaleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rationaleSource: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  rationaleSourceGemini: { color: '#4338CA', backgroundColor: '#EEF2FF' },
  rationaleSourceRules: { color: '#15803D', backgroundColor: '#F0FDF4' },
  rationaleText: { fontSize: 13, color: '#334155', lineHeight: 20, marginTop: 12, fontWeight: '600' },
  rationaleNote: {
    fontSize: 10,
    color: '#64748B',
    lineHeight: 15,
    marginTop: 10,
    fontStyle: 'italic',
  },

  // --- session hero ---
  sessionHero: { backgroundColor: '#0B1F35', borderColor: '#0B1F35' },
  sessionTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sessionBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.16)',
    borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9,
  },
  sessionBadgeText: { fontSize: 9, fontWeight: '900', color: '#FDE68A', letterSpacing: 0.8, marginLeft: 5 },
  readinessTag: { fontSize: 10, fontWeight: '900', color: '#38BDF8', letterSpacing: 1 },
  sessionFocus: { fontSize: 21, fontWeight: '900', color: '#FFFFFF', marginTop: 12, letterSpacing: -0.5, lineHeight: 27 },
  sessionStatRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  sessionBigNum: { fontSize: 34, fontWeight: '900', color: '#F59E0B', letterSpacing: -1 },
  sessionMedNum: { fontSize: 20, fontWeight: '900', color: '#F1F5F9', marginTop: 10 },
  sessionStatLabel: { fontSize: 8, fontWeight: '800', color: '#7C90A8', letterSpacing: 1, marginTop: 2 },
  sessionStatDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 18 },

  sessionBox: { marginTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)', paddingTop: 16 },
  blockRow: { flexDirection: 'row', alignItems: 'flex-start' },
  blockRail: { width: 20, alignItems: 'center' },
  blockDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#F59E0B', marginTop: 4 },
  blockLine: { width: 2, flex: 1, minHeight: 46, backgroundColor: 'rgba(245,158,11,0.28)', marginTop: 2 },
  blockPhase: { fontSize: 9, fontWeight: '900', color: '#7C90A8', letterSpacing: 1 },
  blockBody: { flex: 1, paddingBottom: 16, paddingLeft: 4 },
  blockTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', marginTop: 3 },
  chipRow: { flexDirection: 'row', marginTop: 6 },
  chip: {
    fontSize: 10, fontWeight: '700', color: '#CBD5E1', backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, marginRight: 6, overflow: 'hidden',
  },
  blockCue: { fontSize: 12, color: '#94A3B8', marginTop: 7, lineHeight: 18 },

  stopBox: {
    backgroundColor: 'rgba(225,16,130,0.12)', borderRadius: 12, padding: 12, marginTop: 4,
    borderLeftWidth: 3, borderLeftColor: '#E11082',
  },
  stopTitle: { fontSize: 9, fontWeight: '900', color: '#F472B6', letterSpacing: 0.8, marginBottom: 6 },
  stopRule: { fontSize: 12, color: '#E2E8F0', lineHeight: 19 },
  progressionNote: { fontSize: 12, color: '#94A3B8', lineHeight: 18, marginTop: 12, fontStyle: 'italic' },

  // --- safety envelope ---
  envelopeIntro: { fontSize: 12, color: '#64748B', lineHeight: 18, marginTop: 8, marginBottom: 12 },
  envRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  envLabel: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  envVal: { fontSize: 13, color: '#002B49', fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  planSourceNote: { fontSize: 11, color: '#64748B', marginTop: 12, fontWeight: '700' },

  // --- four-week adaptive progression ---
  progressionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressionAdaptive: {
    fontSize: 9,
    color: '#6366F1',
    fontWeight: '900',
    letterSpacing: 0.8,
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  progressionIntro: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 14,
  },
  progressionRow: { flexDirection: 'row', minHeight: 76 },
  progressionRail: { width: 34, alignItems: 'center' },
  progressionDot: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  progressionDotCurrent: { backgroundColor: '#6366F1', borderColor: '#6366F1' },
  progressionDotEligible: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  progressionDotText: { fontSize: 10, color: '#64748B', fontWeight: '900' },
  progressionDotTextCurrent: { color: '#FFFFFF' },
  progressionDotTextEligible: { color: '#15803D' },
  progressionLine: { width: 2, flex: 1, backgroundColor: '#E2E8F0', marginVertical: 3 },
  progressionBody: { flex: 1, paddingLeft: 7, paddingBottom: 15 },
  progressionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  progressionTitle: { flex: 1, fontSize: 13, color: '#002B49', fontWeight: '900', paddingRight: 8 },
  progressionStatus: { fontSize: 8, color: '#94A3B8', fontWeight: '900', letterSpacing: 0.5 },
  progressionStatusCurrent: { color: '#6366F1' },
  progressionStatusEligible: { color: '#15803D' },
  progressionDetail: { fontSize: 11, color: '#64748B', lineHeight: 17, marginTop: 3 },
  gateList: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 8,
  },
  gateRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  gateText: { flex: 1, fontSize: 10, color: '#64748B', lineHeight: 15, marginLeft: 7 },
  gateTextMet: { color: '#166534', fontWeight: '700' },
  progressionSafetyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    padding: 10,
    marginTop: 2,
  },
  progressionSafetyText: { flex: 1, fontSize: 10, color: '#166534', lineHeight: 15, marginLeft: 7 },

  // --- provisional week ---
  weekNote: { fontSize: 12, color: '#64748B', lineHeight: 17, marginTop: 6, marginBottom: 12 },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  weekDay: { width: 52, fontSize: 11, fontWeight: '800', color: '#94A3B8' },
  weekBody: { flex: 1 },
  weekActivity: { fontSize: 13, fontWeight: '700', color: '#002B49' },
  weekResting: { color: '#94A3B8', fontWeight: '600' },
  weekFocus: { fontSize: 11, color: '#64748B', marginTop: 1 },
  weekIntensity: { fontSize: 11, fontWeight: '700', color: '#E11082' },
  
  explainCard: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 20, 
    padding: 20, 
    marginBottom: 24, 
    borderWidth: 1, 
    borderColor: '#E2E8F0',
    ...Platform.select({
      ios: { shadowColor: '#091E42', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 },
      android: { elevation: 4 }
    })
  },

  sideTabHandle: {
    position: 'absolute',
    right: 0,
    top: '40%',
    backgroundColor: '#E11082',
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 99,
  },
  sideTabHandleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 4,
  },

  profileHeaderBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#002B49',
  },
  profileIdText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },

  actionToolbar: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  toolbarBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#2d87aaff',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#fcfcfcff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  toolbarBtnPrimaryText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
    marginLeft: 8,
  },
  toolbarBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  toolbarBtnSecondaryText: {
    color: '#002B49',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 8,
  },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 4,
    marginTop: 10,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#002B49',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    ...Platform.select({
      ios: { shadowColor: '#002B49', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6 },
      android: { elevation: 3 }
    })
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#002B49',
    letterSpacing: -0.5,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCE7F3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#FBCFE8',
  },
  aiBadgeText: {
    color: '#E11082',
    fontSize: 10,
    fontWeight: '900',
    marginLeft: 2,
  },
  subTitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
  },
  exitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  exitBtnText: {
    color: '#DC2626',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 6,
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activityList: { marginTop: 12 },
  activityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  activityMain: { flex: 1 },
  activityName: { fontSize: 14, fontWeight: '700', color: '#002B49' },
  activityDate: { fontSize: 11, fontWeight: '600', color: '#64748B', marginTop: 2 },
  activityMetrics: { flexDirection: 'row', gap: 6 },
  badge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#334155' },
  noActivityText: { fontSize: 13, color: '#64748B', fontStyle: 'italic', marginTop: 12 },
  explainHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  explainTitle: { fontSize: 14, fontWeight: '800', color: '#002B49', marginLeft: 8 },
  explainBody: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  explainRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  explainLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  explainVal: { fontSize: 13, fontWeight: '800', color: '#002B49' },
  
  bedrockBox: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  bedrockTitle: { fontSize: 11, fontWeight: '800', color: '#E11082', marginBottom: 6, letterSpacing: 0.5 },
  bedrockText: { fontSize: 13, color: '#475569', lineHeight: 20 },
  
  divider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 16 },
  dividerVertical: { width: 1, backgroundColor: '#F1F5F9', height: '100%' },
});
