import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowLeft, ArrowRight, Check, HeartPulse, ShieldCheck } from 'lucide-react-native';
import { createMemberProfile, fetchDashboardData, OnboardingProfile } from '../api';

type Step = 1 | 2 | 3;
type ActivityPreference = OnboardingProfile['activityPreference'];

const CONDITIONS = [
  ['post_illness', 'Illness'],
  ['post_injury', 'Injury'],
  ['post_surgery', 'Surgery'],
  ['post_childbirth', 'Childbirth'],
  ['chronic_condition', 'Chronic condition'],
  ['long_term_inactivity', 'Long inactivity'],
] as const;
const STAGES = ['Early recovery', 'Rebuilding', 'Return to activity'];
const MOBILITY = ['No limitation', 'Short bouts only', 'Lower-impact preferred', 'Pool-based preferred'];

function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [string, string] | string)[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((option) => {
        const key = typeof option === 'string' ? option : option[0];
        const label = typeof option === 'string' ? option : option[1];
        const selected = key === value;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.choice, selected && styles.choiceSelected]}
            onPress={() => onChange(key)}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function OnboardingScreen({ navigation }: any) {
  const [step, setStep] = useState<Step>(1);
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [conditionCategory, setConditionCategory] = useState('post_illness');
  const [diagnosisOrEvent, setDiagnosisOrEvent] = useState('');
  const [recoveryStage, setRecoveryStage] = useState('Early recovery');
  const [painScore, setPainScore] = useState(2);
  const [mobilityLimitation, setMobilityLimitation] = useState('No limitation');
  const [clinicianCleared, setClinicianCleared] = useState('Yes');
  const [activityPreference, setActivityPreference] = useState<ActivityPreference>('walk');
  const [activityBaseline, setActivityBaseline] = useState('');
  const [recoveryGoal, setRecoveryGoal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepValid =
    step === 1
      ? !!firstName.trim() && !!surname.trim()
      : step === 2
        ? !!diagnosisOrEvent.trim()
        : !!activityBaseline.trim() && !!recoveryGoal.trim();

  const next = () => {
    setError(null);
    if (!stepValid) {
      setError('Please complete the required fields before continuing.');
      return;
    }
    setStep((current) => Math.min(3, current + 1) as Step);
  };

  const submit = async () => {
    if (!stepValid || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await createMemberProfile({
      firstName: firstName.trim(),
      surname: surname.trim(),
      recoveryGoal: recoveryGoal.trim(),
      activityBaseline: activityBaseline.trim(),
      activityPreference,
      recoveryContext: {
        conditionCategory,
        diagnosisOrEvent: diagnosisOrEvent.trim(),
        recoveryStage,
        mobilityLimitation,
        clinicianCleared,
        contraindicationFlag: 'No',
        painScore,
      },
    });
    if (!result.created) {
      setError(result.error || 'Could not create this recovery profile.');
      setSubmitting(false);
      return;
    }
    const assignedMemberId = result.memberId;
    if (!assignedMemberId) {
      setError('Your profile was created but no entity number was returned.');
      setSubmitting(false);
      return;
    }
    try {
      const initialData = await fetchDashboardData(assignedMemberId);
      navigation.replace('Dashboard', { entityNumber: assignedMemberId, initialData });
    } catch {
      navigation.replace('Login');
    }
    setSubmitting(false);
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.back}
            onPress={() => (step === 1 ? navigation.goBack() : setStep((step - 1) as Step))}
          >
            <ArrowLeft size={19} color="#002B49" />
          </TouchableOpacity>
          <Text style={styles.stepText}>STEP {step} OF 3</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
        </View>

        <View style={styles.heroIcon}>
          {step === 3 ? <ShieldCheck size={28} color="#E11082" /> : <HeartPulse size={28} color="#E11082" />}
        </View>
        <Text style={styles.title}>
          {step === 1 ? 'Create your profile' : step === 2 ? 'Your recovery context' : 'Movement and goals'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 1
            ? 'Tell us who this recovery plan belongs to.'
            : step === 2
              ? 'These answers set the safety limits for your recommendations.'
              : 'We will use this to personalise your starting activity and progression.'}
        </Text>

        <View style={styles.card}>
          {step === 1 && (
            <>
              <Text style={styles.label}>FIRST NAME *</Text>
              <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="First name" />
              <Text style={styles.label}>SURNAME *</Text>
              <TextInput style={styles.input} value={surname} onChangeText={setSurname} placeholder="Surname" />
              <View style={styles.idNote}>
                <ShieldCheck size={15} color="#0369A1" />
                <Text style={styles.idNoteText}>
                  Your unique entity number will be assigned automatically when your profile is created.
                </Text>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.label}>WHAT ARE YOU RETURNING FROM?</Text>
              <ChoiceRow options={CONDITIONS} value={conditionCategory} onChange={setConditionCategory} />
              <Text style={styles.label}>EVENT OR CONDITION *</Text>
              <TextInput
                style={styles.input}
                value={diagnosisOrEvent}
                onChangeText={setDiagnosisOrEvent}
                placeholder="e.g. Knee surgery or flu"
              />
              <Text style={styles.label}>RECOVERY STAGE</Text>
              <ChoiceRow options={STAGES} value={recoveryStage} onChange={setRecoveryStage} />
              <Text style={styles.label}>PAIN TODAY: {painScore}/10</Text>
              <View style={styles.numberRow}>
                {[0, 2, 4, 6, 8, 10].map((score) => (
                  <TouchableOpacity
                    key={score}
                    style={[styles.numberChoice, painScore === score && styles.numberChoiceSelected]}
                    onPress={() => setPainScore(score)}
                  >
                    <Text style={[styles.numberText, painScore === score && styles.choiceTextSelected]}>{score}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>MOBILITY</Text>
              <ChoiceRow options={MOBILITY} value={mobilityLimitation} onChange={setMobilityLimitation} />
              <Text style={styles.label}>CLEARED BY A CLINICIAN?</Text>
              <ChoiceRow options={['Yes', 'No', 'Not sure']} value={clinicianCleared} onChange={setClinicianCleared} />
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.label}>PREFERRED ACTIVITY</Text>
              <ChoiceRow
                options={[
                  ['walk', 'Walking'],
                  ['run', 'Running'],
                  ['swim', 'Swimming'],
                ]}
                value={activityPreference}
                onChange={(value) => setActivityPreference(value as ActivityPreference)}
              />
              <Text style={styles.label}>CURRENT ACTIVITY BASELINE *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={activityBaseline}
                onChangeText={setActivityBaseline}
                placeholder="e.g. I can walk comfortably for 10 minutes"
                multiline
              />
              <Text style={styles.label}>RECOVERY GOAL *</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={recoveryGoal}
                onChangeText={setRecoveryGoal}
                placeholder="e.g. Return to a comfortable 5 km walk"
                multiline
              />
              <View style={styles.safetyNote}>
                <Check size={16} color="#15803D" />
                <Text style={styles.safetyNoteText}>
                  Your answers create safety limits. Recommendations cannot exceed your clearance and mobility constraints.
                </Text>
              </View>
            </>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={[styles.primary, (!stepValid || submitting) && styles.primaryDisabled]}
            disabled={!stepValid || submitting}
            onPress={step === 3 ? submit : next}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryText}>{step === 3 ? 'Create recovery profile' : 'Continue'}</Text>
                <ArrowRight size={18} color="#FFFFFF" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F7F9' },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center', padding: 20, paddingBottom: 48 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  stepText: { fontSize: 10, color: '#64748B', fontWeight: '900', letterSpacing: 1 },
  progressTrack: { height: 5, backgroundColor: '#E2E8F0', borderRadius: 99, overflow: 'hidden', marginTop: 14 },
  progressFill: { height: '100%', backgroundColor: '#E11082', borderRadius: 99 },
  heroIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#FFF1F7', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  title: { fontSize: 27, fontWeight: '900', color: '#002B49', marginTop: 14 },
  subtitle: { fontSize: 13, color: '#64748B', lineHeight: 20, marginTop: 6, marginBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, borderWidth: 1, borderColor: '#E2E8F0', padding: 20 },
  label: { fontSize: 10, color: '#64748B', fontWeight: '900', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, color: '#002B49', marginBottom: 16 },
  textArea: { minHeight: 78, textAlignVertical: 'top' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  choice: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, marginRight: 7, marginBottom: 7, backgroundColor: '#FFFFFF' },
  choiceSelected: { borderColor: '#E11082', backgroundColor: '#FFF1F7' },
  choiceText: { fontSize: 11, color: '#475569', fontWeight: '700' },
  choiceTextSelected: { color: '#B60867', fontWeight: '900' },
  numberRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  numberChoice: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  numberChoiceSelected: { backgroundColor: '#FFF1F7', borderColor: '#E11082' },
  numberText: { fontSize: 12, color: '#475569', fontWeight: '800' },
  safetyNote: { flexDirection: 'row', backgroundColor: '#F0FDF4', borderRadius: 12, padding: 12, marginBottom: 16 },
  safetyNoteText: { flex: 1, fontSize: 11, color: '#166534', lineHeight: 17, marginLeft: 8 },
  idNote: { flexDirection: 'row', backgroundColor: '#F0F9FF', borderRadius: 12, padding: 12, marginBottom: 16 },
  idNoteText: { flex: 1, fontSize: 11, color: '#075985', lineHeight: 17, marginLeft: 8 },
  error: { fontSize: 12, color: '#DC2626', fontWeight: '700', marginBottom: 12 },
  primary: { minHeight: 50, borderRadius: 14, backgroundColor: '#E11082', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryDisabled: { backgroundColor: '#CBD5E1' },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', marginRight: 8 },
});
