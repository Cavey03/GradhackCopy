import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Target, X } from 'lucide-react-native';
import { RecoveryGoal } from '../mockData';

type Props = {
  visible: boolean;
  onClose: () => void;
  currentGoal?: string;
  onSave: (goal: RecoveryGoal, goalStatement: string) => Promise<boolean>;
};

function inferredType(goal = ''): RecoveryGoal['type'] {
  const text = goal.toLowerCase();
  if (text.includes('vo2') || text.includes('vo₂') || text.includes('fitness')) return 'vo2';
  if (text.includes('minute') || text.includes('duration') || text.includes('time')) return 'duration';
  return 'distance';
}

export default function RecoveryGoalModal({ visible, onClose, currentGoal, onSave }: Props) {
  const [type, setType] = useState<RecoveryGoal['type']>('distance');
  const [activity, setActivity] = useState<'walk' | 'run' | 'swim'>('walk');
  const [target, setTarget] = useState('');
  const [goalStatement, setGoalStatement] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setGoalStatement(currentGoal || '');
    setType(inferredType(currentGoal));
    setError('');
  }, [visible, currentGoal]);

  const save = async () => {
    const value = Number(target);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a target greater than zero.');
      return;
    }
    setSaving(true);
    setError('');
    const unit: RecoveryGoal['unit'] =
      type === 'distance' ? 'km' : type === 'duration' ? 'min' : 'mL/kg/min';
    const ok = await onSave(
      {
        type,
        activity: type === 'vo2' ? undefined : activity,
        target: value,
        unit,
        startedAt: new Date().toISOString(),
      },
      goalStatement,
    );
    setSaving(false);
    if (!ok) {
      setError('Could not update the goal. Please try again.');
      return;
    }
    setTarget('');
    onClose();
  };

  const choices = (
    values: { value: string; label: string }[],
    selected: string,
    select: (value: any) => void,
  ) => (
    <View style={s.choiceRow}>
      {values.map((choice) => (
        <TouchableOpacity
          key={choice.value}
          style={[s.choice, selected === choice.value && s.choiceSelected]}
          onPress={() => select(choice.value)}
        >
          <Text style={[s.choiceText, selected === choice.value && s.choiceTextSelected]}>
            {choice.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.modal}>
          <View style={s.header}>
            <View style={s.titleRow}>
              <Target size={19} color="#E11082" />
              <Text style={s.title}>Set your next recovery goal</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.close}>
              <X size={18} color="#64748B" />
            </TouchableOpacity>
          </View>
          <Text style={s.intro}>
            Keep the member’s recovery intention, then attach one measurable target to it.
          </Text>

          <Text style={s.label}>RECOVERY GOAL</Text>
          <TextInput
            style={s.input}
            value={goalStatement}
            onChangeText={setGoalStatement}
            placeholder="e.g. Improve my VO₂ max"
          />

          <Text style={s.label}>GOAL TYPE</Text>
          {choices(
            [
              { value: 'distance', label: 'Distance' },
              { value: 'duration', label: 'Duration' },
              { value: 'vo2', label: 'VO₂ max' },
            ],
            type,
            setType,
          )}

          {type !== 'vo2' && (
            <>
              <Text style={s.label}>ACTIVITY</Text>
              {choices(
                [
                  { value: 'walk', label: 'Walking' },
                  { value: 'run', label: 'Running' },
                  { value: 'swim', label: 'Swimming' },
                ],
                activity,
                setActivity,
              )}
            </>
          )}

          <Text style={s.label}>
            TARGET ({type === 'distance' ? 'KM' : type === 'duration' ? 'MINUTES' : 'ML/KG/MIN'})
          </Text>
          <TextInput
            style={s.input}
            value={target}
            onChangeText={setTarget}
            keyboardType="decimal-pad"
            placeholder={type === 'distance' ? 'e.g. 5' : type === 'duration' ? 'e.g. 30' : 'e.g. 40'}
          />
          {!!error && <Text style={s.error}>{error}</Text>}
          <TouchableOpacity style={s.save} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveText}>Save new goal</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,43,73,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  title: { fontSize: 17, fontWeight: '900', color: '#002B49', marginLeft: 7 },
  close: { padding: 6 },
  intro: { fontSize: 11, color: '#64748B', lineHeight: 17, marginTop: 10, marginBottom: 14 },
  label: { fontSize: 9, fontWeight: '900', color: '#64748B', letterSpacing: 0.8, marginTop: 10, marginBottom: 7 },
  choiceRow: { flexDirection: 'row', marginHorizontal: -3 },
  choice: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingVertical: 9, marginHorizontal: 3 },
  choiceSelected: { borderColor: '#E11082', backgroundColor: '#FFF1F7' },
  choiceText: { fontSize: 10, color: '#475569', fontWeight: '700' },
  choiceTextSelected: { color: '#B60867', fontWeight: '900' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC', borderRadius: 11, padding: 12, fontSize: 14, color: '#002B49' },
  error: { color: '#DC2626', fontSize: 11, fontWeight: '700', marginTop: 8 },
  save: { backgroundColor: '#E11082', borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
