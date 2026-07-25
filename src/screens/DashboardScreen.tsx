// src/screens/DashboardScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { OPTIMAL_STATE, WARNING_STATE, RecoveryData } from '../mockData';
import { fetchDashboardData, submitCheckIn, submitExerciseLog, generatePlan } from '../api';
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
  Plus
} from 'lucide-react-native';
import TrendChart from '../components/TrendChart';
import DailyCheckInModal from '../components/DailyCheckInModal';
import VitalityScoreRing from '../components/VitalityScoreRing';
import LogExerciseDrawer, { ExerciseLogPayload } from '../components/LogExerciseDrawer';

type CategoryType = 'Recovery' | 'Strain' | 'Sleep' | 'Heart' | 'AI Plan' | 'Profile';

// The headline fields arrive already formatted from api.ts, but plan blocks
// carry the backend's raw vocabulary ("very_low", "mobility").
const titleCase = (s: string) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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

  // "Optimal" vs "at risk" is derived directly from the data
  const isOptimal = data.setback_probability < 0.4;
  const m = data.member;

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
                    {isOptimal ? 'OPTIMAL RECOVERY' : 'SETBACK RISK ALERT'}
                  </Text>
                </View>
              </View>

              <VitalityScoreRing score={data.recovery_score} isOptimal={isOptimal} />
              <Text style={styles.aiSummary}>{data.ai_summary}</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Activity size={16} color="#002B49" />
                <Text style={[styles.cardTitle, { marginLeft: 6 }]}>7-DAY RECOVERY TREND</Text>
              </View>

              <TrendChart isOptimal={isOptimal} />
              <View style={styles.divider} />

              <View style={styles.metricRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.subText}>Baseline VO₂ Max</Text>
                  <Text style={styles.metricVal}>{data.vo2_max_baseline}</Text>
                </View>
                <View style={styles.dividerVertical} />
                <View style={styles.metricBox}>
                  <Text style={styles.subText}>Current Estimated</Text>
                  <Text style={[styles.metricVal, { color: isOptimal ? '#002B49' : '#E11082' }]}>
                    {data.vo2_max_current}
                  </Text>
                </View>
              </View>
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
                    ? 'Generated by Gemini · 1 request per press'
                    : 'Not yet generated · 1 request per press'}
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

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Sparkles size={16} color="#002B49" />
                <Text style={[styles.cardTitle, { marginLeft: 6 }]}>AI RATIONALE & INSIGHTS</Text>
              </View>
              <Text style={styles.aiSummary}>{data.ai_summary}</Text>
            </View>
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

      {/* DAILY CHECK-IN MODAL */}
      <DailyCheckInModal
        visible={checkInVisible}
        onClose={() => setCheckInVisible(false)}
        onSubmitCheckIn={async (hasSymptoms, details) => {
          // The backend re-runs both models on every check-in and returns the
          // fresh prediction, so render that. Previously this discarded the
          // response and swapped in a hardcoded OPTIMAL_STATE/WARNING_STATE,
          // which meant a live check-in displayed mock numbers.
          const result = await submitCheckIn(entityNumber, details, data);
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
  
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 8 },
  metricBox: { flex: 1, alignItems: 'center' },
  subText: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  metricVal: { fontSize: 24, fontWeight: '900', color: '#002B49', marginTop: 4 },
  forecastBox: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#F0F9FF', borderWidth: 1, borderColor: '#BAE6FD', alignItems: 'center' },
  forecastLabel: { fontSize: 11, fontWeight: '900', color: '#0369A1', letterSpacing: 0.8 },
  forecastValue: { fontSize: 24, fontWeight: '900', color: '#002B49', marginTop: 5 },
  forecastChange: { fontSize: 13, fontWeight: '800', marginTop: 4 },
  forecastDisclaimer: { fontSize: 11, color: '#64748B', marginTop: 6, fontStyle: 'italic' },
  
  highlightCard: { backgroundColor: '#002B49', borderColor: '#001A2C' },
  planTitle: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 8, letterSpacing: -0.5 },
  planSub: { fontSize: 13, fontWeight: '700', color: '#E11082', marginTop: 4 },
  coachingMsg: { fontSize: 14, fontStyle: 'italic', color: '#E2E8F0', marginTop: 12, lineHeight: 20 },

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
