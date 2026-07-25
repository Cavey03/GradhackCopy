// src/components/DailyCheckInModal.tsx
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import {
  X,
  Moon,
  Dumbbell,
  Zap,
  AlertTriangle,
  CheckCircle2,
  HeartPulse,
} from 'lucide-react-native';

import { CheckInDetails } from '../api';

interface DailyCheckInModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmitCheckIn: (hasSymptoms: boolean, details: CheckInDetails) => void;
}

export default function DailyCheckInModal({
  visible,
  onClose,
  onSubmitCheckIn,
}: DailyCheckInModalProps) {
  const [sleepQuality, setSleepQuality] = useState<number>(4);
  const [soreness, setSoreness] = useState<number>(2);
  const [energy, setEnergy] = useState<number>(3);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);

  const symptomsList = [
    'Dizziness / Lightheadedness',
    'Elevated Resting HR',
    'Chest Tightness',
    'Joint / Muscle Sharp Pain',
  ];

  const toggleSymptom = (symptom: string) => {
    if (selectedSymptoms.includes(symptom)) {
      setSelectedSymptoms(selectedSymptoms.filter((s) => s !== symptom));
    } else {
      setSelectedSymptoms([...selectedSymptoms, symptom]);
    }
  };

  const handleSubmit = () => {
    const hasRedFlags = selectedSymptoms.length > 0;
    const details: CheckInDetails = {
      sleepQuality,
      soreness,
      energy,
      symptoms: selectedSymptoms,
    };
    if (hasRedFlags) {
      Alert.alert(
        '⚠️ Clinical Safety Gate Triggered',
        'PulseGuard AI detected reported clinical symptoms. Todays plan has automatically switched to low-intensity mobility and recovery guardrails.',
        [
          {
            text: 'Acknowledge Plan Shift',
            onPress: () => {
              onSubmitCheckIn(true, details);
              onClose();
            },
          },
        ]
      );
    } else {
      onSubmitCheckIn(false, details);
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {/* HEADER */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <HeartPulse size={20} color="#E11082" />
              <Text style={styles.headerTitle}>Daily Recovery Check-In</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <X size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.subtitle}>
              Submit today&apos;s recovery signals and request an updated readiness plan.
            </Text>

            {/* 1. SLEEP QUALITY */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Moon size={16} color="#002B49" />
                <Text style={styles.sectionTitle}>Sleep Quality</Text>
              </View>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={`sleep-${val}`}
                    style={[
                      styles.ratingBtn,
                      sleepQuality === val && styles.ratingBtnActive,
                    ]}
                    onPress={() => setSleepQuality(val)}>
                    <Text
                      style={[
                        styles.ratingText,
                        sleepQuality === val && styles.ratingTextActive,
                      ]}>
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.labelRow}>
                <Text style={styles.labelText}>1 = Poor</Text>
                <Text style={styles.labelText}>5 = Restful</Text>
              </View>
            </View>

            {/* 2. MUSCLE SORENESS */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Dumbbell size={16} color="#002B49" />
                <Text style={styles.sectionTitle}>Muscle Soreness</Text>
              </View>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={`soreness-${val}`}
                    style={[
                      styles.ratingBtn,
                      soreness === val && styles.ratingBtnActive,
                    ]}
                    onPress={() => setSoreness(val)}>
                    <Text
                      style={[
                        styles.ratingText,
                        soreness === val && styles.ratingTextActive,
                      ]}>
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.labelRow}>
                <Text style={styles.labelText}>1 = Fresh</Text>
                <Text style={styles.labelText}>5 = Severe</Text>
              </View>
            </View>

            {/* 3. ENERGY LEVEL */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Zap size={16} color="#002B49" />
                <Text style={styles.sectionTitle}>Energy Level</Text>
              </View>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((val) => (
                  <TouchableOpacity
                    key={`energy-${val}`}
                    style={[
                      styles.ratingBtn,
                      energy === val && styles.ratingBtnActive,
                    ]}
                    onPress={() => setEnergy(val)}>
                    <Text
                      style={[
                        styles.ratingText,
                        energy === val && styles.ratingTextActive,
                      ]}>
                      {val}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.labelRow}>
                <Text style={styles.labelText}>1 = Drained</Text>
                <Text style={styles.labelText}>5 = Energized</Text>
              </View>
            </View>

            {/* 4. CLINICAL SAFETY CHECK */}
            <View style={[styles.section, styles.clinicalSection]}>
              <View style={styles.sectionHeader}>
                <AlertTriangle size={16} color="#DC2626" />
                <Text style={[styles.sectionTitle, { color: '#991B1B' }]}>
                  Clinical Red Flags
                </Text>
              </View>
              <Text style={styles.clinicalSubtext}>
                Select any active symptoms from the past 24 hours:
              </Text>

              <View style={styles.symptomGrid}>
                {symptomsList.map((symptom) => {
                  const isSelected = selectedSymptoms.includes(symptom);
                  return (
                    <TouchableOpacity
                      key={symptom}
                      style={[
                        styles.symptomChip,
                        isSelected && styles.symptomChipActive,
                      ]}
                      onPress={() => toggleSymptom(symptom)}>
                      <Text
                        style={[
                          styles.symptomText,
                          isSelected && styles.symptomTextActive,
                        ]}>
                        {symptom}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* SUBMIT BUTTON */}
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
              <Text style={styles.submitBtnText}>Recalibrate Plan</Text>
              <CheckCircle2 size={18} color="#FFF" />
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#002B49',
    marginLeft: 8,
  },
  closeBtn: {
    padding: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 16,
    fontWeight: '500',
  },
  section: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#002B49',
    marginLeft: 6,
    letterSpacing: 0.5,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ratingBtn: {
    flex: 1,
    height: 38,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 3,
  },
  ratingBtnActive: {
    backgroundColor: '#002B49',
    borderColor: '#002B49',
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#475569',
  },
  ratingTextActive: {
    color: '#FFF',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  labelText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  clinicalSection: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  clinicalSubtext: {
    fontSize: 11,
    color: '#7F1D1D',
    marginBottom: 10,
    fontWeight: '500',
  },
  symptomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  symptomChip: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  symptomChipActive: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  symptomText: {
    fontSize: 11,
    color: '#991B1B',
    fontWeight: '700',
  },
  symptomTextActive: {
    color: '#FFF',
  },
  submitBtn: {
    backgroundColor: '#E11082',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  submitBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 14,
    marginRight: 8,
  },
});
