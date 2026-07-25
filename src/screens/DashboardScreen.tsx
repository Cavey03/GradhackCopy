// src/screens/DashboardScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { OPTIMAL_STATE, WARNING_STATE, RecoveryData } from '../mockData';
import { fetchDashboardData, submitCheckIn, generatePlan } from '../api';
import { 
  ShieldCheck, 
  AlertTriangle, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Activity, 
  ClipboardCheck,
  Zap,
  Moon,
  Heart,
  LogOut,
  User
} from 'lucide-react-native';
import TrendChart from '../components/TrendChart';
import DailyCheckInModal from '../components/DailyCheckInModal';
import VitalityScoreRing from '../components/VitalityScoreRing';


type CategoryType = 'Recovery' | 'Strain' | 'Sleep' | 'Heart' | 'AI Plan' | 'Profile';

// The headline fields arrive already formatted from api.ts, but plan blocks
// carry the backend's raw vocabulary ("very_low", "mobility").
const titleCase = (s: string) =>
  (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function DashboardScreen({ navigation, route }: any) {
  const entityNumber = route?.params?.entityNumber || 'ENT000122';
  const [data, setData] = useState<RecoveryData>(route?.params?.initialData || OPTIMAL_STATE);
  const [activeCategory, setActiveCategory] = useState<CategoryType>('Recovery');
  const [showExplainability, setShowExplainability] = useState(true);
  const [checkInVisible, setCheckInVisible] = useState(false);
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

  // "Optimal" vs "at risk" is now derived from the data instead of a toggle
  const isOptimal = data.setback_probability < 0.4;

  // If Login didn't pass data (e.g. deep link during dev), fetch it live
  useEffect(() => {
    if (!route?.params?.initialData) {
      fetchDashboardData(entityNumber).then(setData).catch(() => {});
    }
  }, [entityNumber]);

  // Refetch whenever this screen regains focus, so returning from the
  // Simulator shows the prediction produced by the simulated data instead of
  // the stale copy this component still holds.
  useEffect(
    () => navigation.addListener('focus', () => {
      fetchDashboardData(entityNumber).then(setData).catch(() => {});
    }),
    [navigation, entityNumber],
  );

  const categories = [
    { id: 'Recovery', label: 'Recovery', color: '#E11082', Icon: Activity },
    { id: 'Strain', label: 'Strain', color: '#00A3E0', Icon: Zap },
    { id: 'Sleep', label: 'Sleep', color: '#8B5CF6', Icon: Moon },
    { id: 'Heart', label: 'Heart', color: '#10B981', Icon: Heart },
    { id: 'AI Plan', label: 'AI Plan', color: '#F59E0B', Icon: Sparkles },
    { id: 'Profile', label: 'Profile', color: '#6366F1', Icon: User },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>

<View style={styles.headerRow}>
  <Text style={styles.headerTitle}>PulseGuard</Text>
  
  {/* DATA SOURCE INDICATOR BADGE */}
  <View
    style={[
      styles.sourceBadge,
      {
        backgroundColor:
          data.dataSource === 'LIVE_API' ? '#DCFCE7' : '#FEF3C7',
        borderColor:
          data.dataSource === 'LIVE_API' ? '#16A34A' : '#D97706',
      },
    ]}
  >
    <View
      style={[
        styles.dot,
        {
          backgroundColor:
            data.dataSource === 'LIVE_API' ? '#16A34A' : '#D97706',
        },
      ]}
    />
    <Text
      style={[
        styles.sourceBadgeText,
        {
          color:
            data.dataSource === 'LIVE_API' ? '#15803D' : '#B45309',
        },
      ]}
    >
      {data.dataSource === 'LIVE_API' ? 'LIVE DYNAMODB' : 'MOCK FALLBACK'}
    </Text>
  </View>
</View>

    {/* TOP BRANDING & EXIT ROW */}
      <View style={styles.topHeaderRow}>
        <View style={styles.brandContainer}>
          <View style={styles.brandIconBox}>
            <Activity size={20} color="#FFF" />
          </View>
          <View>
            <View style={styles.brandTitleRow}>
              <Text style={styles.appTitle}>PulseGuard</Text>
              <View style={styles.aiBadge}>
                <Sparkles size={10} color="#E11082" />
                <Text style={styles.aiBadgeText}>AI</Text>
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

      {/* 1. RECOVERY VIEW (Default Hero View) */}
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

    <View style={styles.divider} />

    <View style={styles.explainRow}>
      <Text style={styles.explainLabel}>First Name:</Text>
      <Text style={styles.explainVal}>{data.member?.firstName || '—'}</Text>
    </View>

    <View style={styles.explainRow}>
      <Text style={styles.explainLabel}>Surname:</Text>
      <Text style={styles.explainVal}>{data.member?.surname || '—'}</Text>
    </View>

    <View style={styles.explainRow}>
      <Text style={styles.explainLabel}>Active Injury / Diagnosis:</Text>
      <Text style={[styles.explainVal, { color: isOptimal ? '#10B981' : '#DC2626' }]}>
        {data.member?.injury || 'None'}
      </Text>
    </View>

    <View style={styles.explainRow}>
      <Text style={styles.explainLabel}>Clinical Stage:</Text>
      <Text style={styles.explainVal}>Stage {data.recovery_stage}</Text>
    </View>

    <View style={styles.explainRow}>
      <Text style={styles.explainLabel}>Baseline VO₂ Max:</Text>
      <Text style={styles.explainVal}>{data.vo2_max_baseline} mL/kg/min</Text>
    </View>
  </View>
)}


      {/* PRESCRIBED PLAN (Visible across all views) */}
      <View style={[styles.card, styles.highlightCard]}>
        <Text style={styles.cardTitleLight}>TODAY'S AI PRESCRIBED PLAN</Text>
        <Text style={styles.planTitle}>{data.duration_minutes} min {data.recommended_activity}</Text>
        <Text style={styles.planSub}>Target Intensity: {data.intensity}</Text>
        <Text style={styles.coachingMsg}>"{data.ai_coaching_message}"</Text>
      </View>

      {/* ---------------- AI PLAN TAB ---------------- */}
      {activeCategory === 'AI Plan' && (
        <>
          {/* Generation is explicit. Mount and focus never trigger it, so the
              LLM quota can only be spent by a deliberate press. */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Sparkles size={16} color="#F59E0B" />
              <Text style={[styles.cardTitle, { marginLeft: 6 }]}>AI SESSION PLAN</Text>
            </View>

            <TouchableOpacity
              style={[styles.generateBtn, generating && styles.generateBtnBusy]}
              onPress={onGeneratePlan}
              disabled={generating}
              activeOpacity={0.85}
            >
              {generating ? (
                <>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.generateBtnText}>Generating…</Text>
                </>
              ) : (
                <>
                  <Sparkles size={16} color="#FFFFFF" />
                  <Text style={styles.generateBtnText}>
                    {data.planSource === 'gemini' ? 'Regenerate AI Plan' : 'Generate AI Plan'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.quotaHint}>
              This button is the only thing in the app that calls Gemini, and it uses exactly
              one request. Opening screens, checking in and logging activities are all free.
            </Text>

            {!!planError && <Text style={styles.planErrorText}>{planError}</Text>}
          </View>

          {data.exercisePlan ? (
            <>
              {/* SESSION DETAIL */}
              <View style={[styles.card, styles.highlightCard]}>
                <Text style={styles.cardTitleLight}>TODAY'S SESSION</Text>
                {!!data.exercisePlan.session_focus && (
                  <Text style={styles.sessionFocus}>{data.exercisePlan.session_focus}</Text>
                )}
                <Text style={styles.sessionTotal}>{data.exercisePlan.total_minutes} min total</Text>

                <View style={styles.sessionBox}>
                  {data.exercisePlan.blocks.map((block, index) => (
                    <View key={index} style={styles.blockRow}>
                      <Text style={styles.blockPhase}>{block.phase.toUpperCase()}</Text>
                      <View style={styles.blockBody}>
                        <Text style={styles.blockTitle}>
                          {block.minutes} min {titleCase(block.activity)}
                          {' · '}{titleCase(block.intensity)}
                          {block.target_rpe ? ` · RPE ${block.target_rpe}` : ''}
                        </Text>
                        {!!block.cue && <Text style={styles.blockCue}>{block.cue}</Text>}
                      </View>
                    </View>
                  ))}

                  {!!data.exercisePlan.stop_rules?.length && (
                    <View style={styles.stopBox}>
                      <Text style={styles.stopTitle}>STOP IF</Text>
                      {data.exercisePlan.stop_rules.map((rule, index) => (
                        <Text key={index} style={styles.stopRule}>• {rule}</Text>
                      ))}
                    </View>
                  )}

                  {/* Third status indicator, independent of dataSource and
                      coachSource: whether the LLM's plan survived validation
                      against the model's envelope. */}
                  <Text style={styles.planSourceNote}>
                    {data.planSource === 'gemini'
                      ? 'Designed by Gemini within the model’s safety limits'
                      : data.planSource === 'rules'
                        ? 'Standard session — the AI plan failed the safety check'
                        : 'Standard session from the model — tap Generate for an AI-designed one'}
                  </Text>
                </View>
              </View>

              {/* PROVISIONAL WEEK */}
              {!!data.weekPlan?.length && (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>THIS WEEK (PROVISIONAL)</Text>
                  <Text style={styles.weekNote}>
                    Day 1 follows today’s model prediction. Days 2–7 are a provisional shape,
                    not a forecast, and are rebuilt each time the plan is regenerated.
                  </Text>
                  {data.weekPlan.map((day) => {
                    const resting = day.activity === 'rest' || day.durationMinutes === 0;
                    return (
                      <View key={day.day} style={styles.weekRow}>
                        <Text style={styles.weekDay}>Day {day.day}</Text>
                        <View style={styles.weekBody}>
                          <Text style={[styles.weekActivity, resting && styles.weekResting]}>
                            {resting ? 'Rest' : `${day.durationMinutes} min ${titleCase(day.activity)}`}
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
            <View style={styles.card}>
              <Text style={styles.emptyPlanTitle}>No session plan stored yet</Text>
              <Text style={styles.emptyPlanText}>
                This member’s last prediction was saved before session plans existed. Press
                Generate above for a Gemini-designed session, or submit a check-in — that
                rebuilds the deterministic plan for free.
              </Text>
            </View>
          )}
        </>
      )}

      {/* AI EXPLAINABILITY CARD */}
      <View style={styles.explainCard}>
        <TouchableOpacity 
          style={styles.explainHeader} 
          onPress={() => setShowExplainability(!showExplainability)}>
          <View style={styles.cardHeaderRow}>
            <Sparkles size={18} color="#E11082" />
            <Text style={styles.explainTitle}>Why This Plan? (AI Explainability)</Text>
          </View>
          {showExplainability ? <ChevronUp size={18} color="#64748B" /> : <ChevronDown size={18} color="#64748B" />}
        </TouchableOpacity>

        {showExplainability && (
          <View style={styles.explainBody}>
            <View style={styles.explainRow}>
              <Text style={styles.explainLabel}>Primary Driver:</Text>
              <Text style={styles.explainVal}>{data.explainability.primary_factor}</Text>
            </View>
            <View style={styles.explainRow}>
              <Text style={styles.explainLabel}>Resting HR Shift:</Text>
              <Text style={styles.explainVal}>{data.explainability.resting_hr_delta}</Text>
            </View>
            <View style={styles.explainRow}>
              <Text style={styles.explainLabel}>7-Day Strain:</Text>
              <Text style={styles.explainVal}>{data.explainability.training_load_7d}</Text>
            </View>
            {/* Bedrock is denied by an org SCP on this account and is not used
                anywhere in the stack. The prose is written by Gemini, or by a
                canned fallback when generation fails — label it honestly. */}
            <View style={styles.bedrockBox}>
              <Text style={styles.bedrockTitle}>
                {data.coachSource === 'gemini'
                  ? 'Gemini AI Rationale'
                  : data.coachSource === 'not_requested'
                    ? 'Standard Guidance (Tap Generate AI Plan)'
                    : 'Standard Guidance (AI Unavailable)'}
              </Text>
              <Text style={styles.bedrockText}>{data.explainability.bedrock_rationale}</Text>
            </View>
          </View>
        )}
      </View>

      {/* DAILY CHECK-IN MODAL */}
      <DailyCheckInModal
        visible={checkInVisible}
        onClose={() => setCheckInVisible(false)}
        onSubmitCheckIn={(hasSymptoms, details) => {
          // Persist the check-in to DynamoDB (fire-and-forget; never blocks the demo)
          submitCheckIn(entityNumber, details);
          // Local plan shift until the real ML pipeline returns per-check-in predictions;
          // keep the member's live VO2 values from the API
          setData((prev) => ({
            ...(hasSymptoms ? WARNING_STATE : OPTIMAL_STATE),
            vo2_max_baseline: prev.vo2_max_baseline,
            vo2_max_current: prev.vo2_max_current,
          }));
        }}
      />

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F7F9' }, // Soft, clean off-white background
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
  
  // Clean Premium Cards
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
  
  highlightCard: { backgroundColor: '#002B49', borderColor: '#001A2C' },
  planTitle: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 8, letterSpacing: -0.5 },
  planSub: { fontSize: 13, fontWeight: '700', color: '#E11082', marginTop: 4 },
  coachingMsg: { fontSize: 14, fontStyle: 'italic', color: '#E2E8F0', marginTop: 12, lineHeight: 20 },

  // --- AI Plan tab: generate control ---
  generateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F59E0B', borderRadius: 14, paddingVertical: 14, marginTop: 14,
  },
  generateBtnBusy: { backgroundColor: '#FBBF24' },
  generateBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginLeft: 8 },
  quotaHint: { fontSize: 11, color: '#94A3B8', marginTop: 10, textAlign: 'center', lineHeight: 16 },
  planErrorText: { fontSize: 12, color: '#DC2626', marginTop: 10, fontWeight: '600' },
  emptyPlanTitle: { fontSize: 15, fontWeight: '800', color: '#002B49' },
  emptyPlanText: { fontSize: 13, color: '#64748B', lineHeight: 20, marginTop: 6 },

  // --- structured session (inside a dark card) ---
  sessionBox: { marginTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 14 },
  sessionFocus: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', marginTop: 8 },
  sessionTotal: { fontSize: 13, fontWeight: '700', color: '#F59E0B', marginTop: 4 },
  blockRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  blockPhase: { width: 74, fontSize: 9, fontWeight: '800', color: '#E11082', letterSpacing: 0.8, marginTop: 3 },
  blockBody: { flex: 1 },
  blockTitle: { fontSize: 13, fontWeight: '700', color: '#F1F5F9' },
  blockCue: { fontSize: 12, color: '#94A3B8', marginTop: 2, lineHeight: 17 },
  stopBox: { backgroundColor: 'rgba(225,16,130,0.10)', borderRadius: 10, padding: 10, marginTop: 4 },
  stopTitle: { fontSize: 9, fontWeight: '800', color: '#F472B6', letterSpacing: 0.8, marginBottom: 4 },
  stopRule: { fontSize: 12, color: '#E2E8F0', lineHeight: 18 },
  planSourceNote: { fontSize: 10, color: '#94A3B8', marginTop: 12, fontWeight: '600' },

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
  // Activity List Block Styles
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