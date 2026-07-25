// src/screens/DashboardScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { OPTIMAL_STATE, WARNING_STATE, RecoveryData } from '../mockData';
import { fetchDashboardData, submitCheckIn, submitExerciseLog } from '../api';
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

export default function DashboardScreen({ navigation, route }: any) {
  const entityNumber = route?.params?.entityNumber || 'ENT000122';
  const [data, setData] = useState<RecoveryData>(route?.params?.initialData || OPTIMAL_STATE);
  const [activeCategory, setActiveCategory] = useState<CategoryType>('Recovery');
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [logDrawerVisible, setLogDrawerVisible] = useState(false);

  // "Optimal" vs "at risk" is derived directly from the data
  const isOptimal = data.setback_probability < 0.4;

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

        {/* 6. DEDICATED AI PLAN VIEW */}
        {activeCategory === 'AI Plan' && (
          <>
            <View style={[styles.card, styles.highlightCard]}>
              <View style={styles.cardHeaderRow}>
                <Sparkles size={18} color="#E11082" />
                <Text style={[styles.cardTitleLight, { marginLeft: 6 }]}>TODAY'S AI PRESCRIBED PLAN</Text>
              </View>
              <Text style={styles.planTitle}>{data.duration_minutes} min {data.recommended_activity}</Text>
              <Text style={styles.planSub}>Target Intensity: {data.intensity}</Text>
              <Text style={styles.coachingMsg}>"{data.ai_coaching_message}"</Text>
            </View>

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
        onSubmitCheckIn={(hasSymptoms, details) => {
          submitCheckIn(entityNumber, details);
          setData((prev) => ({
            ...(hasSymptoms ? WARNING_STATE : OPTIMAL_STATE),
            vo2_max_baseline: prev.vo2_max_baseline,
            vo2_max_current: prev.vo2_max_current,
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
  
  highlightCard: { backgroundColor: '#002B49', borderColor: '#001A2C' },
  planTitle: { fontSize: 22, fontWeight: '900', color: '#FFFFFF', marginTop: 8, letterSpacing: -0.5 },
  planSub: { fontSize: 13, fontWeight: '700', color: '#E11082', marginTop: 4 },
  coachingMsg: { fontSize: 14, fontStyle: 'italic', color: '#E2E8F0', marginTop: 12, lineHeight: 20 },
  
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