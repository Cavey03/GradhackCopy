// src/components/LogExerciseDrawer.tsx
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { X, Activity, Flame, Heart, Timer, Navigation } from 'lucide-react-native';

export type ActivityType = 'Running' | 'Walking' | 'Swimming';

export interface ExerciseLogPayload {
  activityType: ActivityType;
  durationMin: number;
  distanceKm: number;
  avgHr: number;
  maxHr: number;
  calories: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: ExerciseLogPayload) => void;
}

export default function LogExerciseDrawer({ visible, onClose, onSubmit }: Props) {
  const [activityType, setActivityType] = useState<ActivityType>('Running');
  const [durationMin, setDurationMin] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const [calories, setCalories] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSave = () => {
    if (!durationMin || !distanceKm || !avgHr || !maxHr || !calories) {
      setErrorMsg('Please fill in all metrics before saving.');
      return;
    }

    const payload: ExerciseLogPayload = {
      activityType,
      durationMin: parseFloat(durationMin),
      distanceKm: parseFloat(distanceKm),
      avgHr: parseInt(avgHr, 10),
      maxHr: parseInt(maxHr, 10),
      calories: parseInt(calories, 10),
    };

    setErrorMsg('');
    onSubmit(payload);
    resetForm();
    onClose();
  };

  const resetForm = () => {
    setActivityType('Running');
    setDurationMin('');
    setDistanceKm('');
    setAvgHr('');
    setMaxHr('');
    setCalories('');
    setErrorMsg('');
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.drawerContainer}>
          {/* DRAWER HEADER */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Activity size={20} color="#E11082" />
              <Text style={styles.headerTitle}>Manual Activity Log</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            {errorMsg ? <Text style={styles.errorBanner}>{errorMsg}</Text> : null}

            {/* 1. ACTIVITY SELECTOR */}
            <Text style={styles.label}>Select Activity Type</Text>
            <View style={styles.activityRow}>
              {(['Running', 'Walking', 'Swimming'] as ActivityType[]).map((type) => {
                const isSelected = activityType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.activityChip,
                      isSelected && styles.activityChipSelected,
                    ]}
                    onPress={() => setActivityType(type)}
                  >
                    <Text
                      style={[
                        styles.activityChipText,
                        isSelected && styles.activityChipTextSelected,
                      ]}
                    >
                      {type === 'Running' ? '🏃 ' : type === 'Walking' ? '🚶 ' : '🏊 '}
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 2. DURATION & DISTANCE ROW */}
            <View style={styles.inputRow}>
              <View style={styles.inputFlex}>
                <Text style={styles.label}>
                  <Timer size={12} color="#002B49" /> Duration (mins)
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 45"
                  keyboardType="numeric"
                  value={durationMin}
                  onChangeText={setDurationMin}
                />
              </View>

              <View style={styles.inputFlex}>
                <Text style={styles.label}>
                  <Navigation size={12} color="#002B49" /> Distance (km)
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5.2"
                  keyboardType="decimal-pad"
                  value={distanceKm}
                  onChangeText={setDistanceKm}
                />
              </View>
            </View>

            {/* 3. HEART RATE METRICS ROW */}
            <View style={styles.inputRow}>
              <View style={styles.inputFlex}>
                <Text style={styles.label}>
                  <Heart size={12} color="#002B49" /> Avg HR (bpm)
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 145"
                  keyboardType="numeric"
                  value={avgHr}
                  onChangeText={setAvgHr}
                />
              </View>

              <View style={styles.inputFlex}>
                <Text style={styles.label}>
                  <Heart size={12} color="#DC2626" /> Max HR (bpm)
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 172"
                  keyboardType="numeric"
                  value={maxHr}
                  onChangeText={setMaxHr}
                />
              </View>
            </View>

            {/* 4. ENERGY EXPENDITURE */}
            <View>
              <Text style={styles.label}>
                <Flame size={12} color="#F97316" /> Calories burned (kcal)
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 320"
                keyboardType="numeric"
                value={calories}
                onChangeText={setCalories}
              />
            </View>

            {/* SAVE BUTTON */}
            <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
              <Text style={styles.saveBtnText}>Save Activity to Database</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 43, 73, 0.4)',
  },
  backdrop: {
    flex: 1,
  },
  drawerContainer: {
    width: '88%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    height: '100%',
    padding: 20,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: -4, height: 0 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 8 },
    }),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginTop: Platform.OS === 'ios' ? 40 : 10,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#002B49' },
  closeBtn: { padding: 6, backgroundColor: '#F8FAFC', borderRadius: 8 },
  body: { marginTop: 16 },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    color: '#DC2626',
    padding: 10,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 12,
  },
  label: { fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 6, marginTop: 12 },
  activityRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  activityChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  activityChipSelected: {
    backgroundColor: '#002B49',
    borderColor: '#002B49',
  },
  activityChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  activityChipTextSelected: { color: '#FFFFFF' },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputFlex: { flex: 1 },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '600',
    color: '#002B49',
  },
  saveBtn: {
    backgroundColor: '#E11082',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 28,
  },
  saveBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
});
