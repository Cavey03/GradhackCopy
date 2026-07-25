// src/components/WearableSimulatorModal.tsx
//
// Presenter tool: step a member's wearable trend forward one day (or week) at
// a time and watch the real pipeline respond — DynamoDB write, SageMaker
// inference, Gemini coaching.
//
// Each metric goes to the endpoint that already owns it:
//   telemetry (resting HR, HRV, sleep, VO2, steps, active minutes)
//        -> POST /wearables/simulate   (READING# item)
//   pain / fatigue
//        -> POST /checkins             (CHECKIN# item)
// RPE is deliberately NOT submitted: it belongs to POST /activities, and no
// activity happens in a wearable step. It is shown as context only.

import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { simulateWearable, submitCheckIn, WearableReading } from '../api';

export type ScenarioKey = 'improving' | 'stable' | 'declining' | 'setback';

export interface WearableBaseline {
  restingHr: number;
  hrBaseline: number;
  hrvMs: number;
  sleepHours: number;
  vo2max: number;
  steps: number;
  activeMinutes: number;
  pain: number;
  fatigue: number;
}

const DEFAULT_BASELINE: WearableBaseline = {
  restingHr: 58, hrBaseline: 56, hrvMs: 42, sleepHours: 7.2,
  vo2max: 38.2, steps: 6200, activeMinutes: 28, pain: 2, fatigue: 2,
};

// Deterministic per-step deltas. No randomness: the same scenario always
// produces the same numbers, so a rehearsed demo behaves identically.
const SCENARIOS: Record<ScenarioKey, { label: string; blurb: string; color: string; delta: Partial<WearableBaseline> }> = {
  improving: {
    label: 'Improving', blurb: 'Recovering well', color: '#16A34A',
    delta: { restingHr: -2, hrvMs: +4, sleepHours: +0.4, vo2max: +0.3, steps: +800, activeMinutes: +5, pain: -1, fatigue: -1 },
  },
  stable: {
    label: 'Stable', blurb: 'Holding steady', color: '#0284C7',
    delta: { restingHr: 0, hrvMs: +1, sleepHours: +0.1, vo2max: +0.05, steps: +100, activeMinutes: +1, pain: 0, fatigue: 0 },
  },
  declining: {
    label: 'Declining', blurb: 'Drifting the wrong way', color: '#D97706',
    delta: { restingHr: +3, hrvMs: -5, sleepHours: -0.6, vo2max: -0.2, steps: -900, activeMinutes: -6, pain: +1, fatigue: +1 },
  },
  setback: {
    // pain +5 takes a step-1 setback to 7, which is where the model flips to
    // REDUCE. At +4 it lands on 6 and stays MAINTAIN, so a single click would
    // move only the risk number and the demo would fall flat.
    label: 'Setback', blurb: 'Acute regression', color: '#DC2626',
    delta: { restingHr: +8, hrvMs: -12, sleepHours: -1.5, vo2max: -0.5, steps: -2500, activeMinutes: -15, pain: +5, fatigue: +5 },
  },
};

const BOUNDS: Record<keyof WearableBaseline, [number, number]> = {
  restingHr: [40, 110], hrBaseline: [40, 110], hrvMs: [10, 140], sleepHours: [3, 10],
  vo2max: [15, 65], steps: [0, 25000], activeMinutes: [0, 180], pain: [0, 10], fatigue: [0, 10],
};

const clamp = (key: keyof WearableBaseline, value: number) => {
  const [lo, hi] = BOUNDS[key];
  return Math.min(hi, Math.max(lo, value));
};

const round = (key: keyof WearableBaseline, value: number) =>
  key === 'sleepHours' || key === 'vo2max' ? Math.round(value * 10) / 10 : Math.round(value);

function applyScenario(base: WearableBaseline, scenario: ScenarioKey, steps: number): WearableBaseline {
  const { delta } = SCENARIOS[scenario];
  const next = { ...base };
  (Object.keys(delta) as (keyof WearableBaseline)[]).forEach((key) => {
    next[key] = clamp(key, round(key, base[key] + (delta[key] ?? 0) * steps));
  });
  return next;
}

type SendState = 'idle' | 'sending' | 'done';
interface StepResult {
  wearable: boolean;
  checkin: boolean;
  readiness?: string;
  activity?: string;
  duration?: number;
  setback?: number;
  coachSummary?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  memberId: string;
  baseline?: Partial<WearableBaseline>;
  onApplied?: () => void;
}

export default function WearableSimulatorModal({ visible, onClose, memberId, baseline, onApplied }: Props) {
  const [scenario, setScenario] = useState<ScenarioKey>('improving');
  const [cadence, setCadence] = useState<1 | 7>(1);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<SendState>('idle');
  const [result, setResult] = useState<StepResult | null>(null);

  const start = useMemo<WearableBaseline>(() => ({ ...DEFAULT_BASELINE, ...baseline }), [baseline]);
  const current = useMemo(() => applyScenario(start, scenario, step), [start, scenario, step]);

  // Advance the date so each step extends the trend rather than overwriting
  // the same day; rolling 3-session features need distinct dates.
  const stamp = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + step * cadence);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }, [step, cadence]);

  const send = async () => {
    setState('sending');
    setResult(null);

    const reading: WearableReading = {
      timestamp: stamp,
      restingHr: current.restingHr,
      hrBaseline: current.hrBaseline,
      vo2max: current.vo2max,
      sleepHours: current.sleepHours,
      steps: current.steps,
      activeMinutes: current.activeMinutes,
      hrvMs: current.hrvMs,
    };

    // Telemetry first, then the check-in, so the inference triggered by the
    // check-in already sees the new reading.
    const wearable = await simulateWearable(memberId, reading);
    // Same timestamp as the reading: inference.py keys sessions by date, so
    // both must land on the same simulated day to be seen as one session.
    // submitCheckIn takes a 1-5 energy value and sends fatigue = 6 - energy,
    // so invert here. Clamp to 1..5 — the metric bounds are 0..10 and using
    // them here would let energy go negative and silently distort fatigue.
    const energy = Math.min(5, Math.max(1, 6 - current.fatigue));
    const checkin = await submitCheckIn(memberId, {
      soreness: current.pain,
      energy,
      sleepQuality: 3,
      symptoms: scenario === 'setback' ? ['fatigue'] : [],
      timestamp: stamp,
    });

    const p: any = checkin.prediction;
    setResult({
      wearable: wearable.recorded,
      checkin: checkin.recorded,
      readiness: p?.readiness,
      activity: p?.recommended_activity,
      duration: p?.duration_minutes,
      setback: p?.setback_probability,
      coachSummary: checkin.coach?.summary,
    });
    setState('done');
    if (wearable.recorded || checkin.recorded) onApplied?.();
  };

  const nextStep = () => { setStep((s) => s + 1); setState('idle'); setResult(null); };
  const reset = () => { setStep(1); setState('idle'); setResult(null); };

  const rows: [string, string][] = [
    ['Resting HR', `${current.restingHr} bpm`],
    ['HRV', `${current.hrvMs} ms`],
    ['Sleep', `${current.sleepHours} h`],
    ['VO₂ max', `${current.vo2max}`],
    ['Steps', `${current.steps}`],
    ['Active minutes', `${current.activeMinutes} min`],
    ['Pain', `${current.pain} / 10`],
    ['Fatigue', `${current.fatigue} / 10`],
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.demoBanner}>
            <Text style={s.demoBannerText}>DEMO MODE — SIMULATED WEARABLE DATA</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.title}>Recovery Trend Simulator</Text>
            <Text style={s.sub}>{memberId} · step {step} · {cadence === 1 ? 'daily' : 'weekly'}</Text>

            <Text style={s.section}>Scenario</Text>
            <View style={s.chipRow}>
              {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
                const active = key === scenario;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[s.chip, active && { backgroundColor: SCENARIOS[key].color, borderColor: SCENARIOS[key].color }]}
                    onPress={() => { setScenario(key); setState('idle'); setResult(null); }}
                  >
                    <Text style={[s.chipText, active && { color: '#FFF' }]}>{SCENARIOS[key].label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.blurb}>{SCENARIOS[scenario].blurb}</Text>

            <Text style={s.section}>Cadence</Text>
            <View style={s.chipRow}>
              {([1, 7] as const).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[s.chip, cadence === c && { backgroundColor: '#334155', borderColor: '#334155' }]}
                  onPress={() => { setCadence(c); setState('idle'); setResult(null); }}
                >
                  <Text style={[s.chipText, cadence === c && { color: '#FFF' }]}>{c === 1 ? 'Next day' : 'Next week'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.section}>Preview — will be sent</Text>
            <View style={s.card}>
              {rows.map(([label, value]) => (
                <View key={label} style={s.row}>
                  <Text style={s.rowLabel}>{label}</Text>
                  <Text style={s.rowValue}>{value}</Text>
                </View>
              ))}
              <Text style={s.stamp}>timestamp {stamp}</Text>
            </View>

            <Text style={s.note}>
              Perceived exertion (RPE) belongs to the activity flow and is not submitted in this
              demo version — no workout is being logged.
            </Text>

            {state === 'done' && result && (
              <View style={s.card}>
                <Text style={s.section}>Result</Text>
                <Text style={[s.status, { color: result.wearable ? '#16A34A' : '#DC2626' }]}>
                  {result.wearable ? '✓ Wearable telemetry saved' : '✕ Wearable telemetry failed'}
                </Text>
                <Text style={[s.status, { color: result.checkin ? '#16A34A' : '#DC2626' }]}>
                  {result.checkin ? '✓ Check-in saved' : '✕ Check-in failed'}
                </Text>
                <Text style={[s.status, { color: '#64748B' }]}>• Activity not submitted (by design)</Text>

                {result.readiness ? (
                  <View style={s.modelBox}>
                    <Text style={s.modelTitle}>Model response</Text>
                    <Text style={s.modelLine}>
                      {result.readiness} · {result.activity} {result.duration ? `${result.duration} min` : ''}
                    </Text>
                    <Text style={s.modelLine}>
                      setback risk {result.setback != null ? `${Math.round(result.setback * 100)}%` : '—'}
                    </Text>
                    {result.coachSummary ? <Text style={s.coach}>"{result.coachSummary}"</Text> : null}
                  </View>
                ) : (
                  <Text style={s.offline}>
                    Offline — nothing reached AWS. The dashboard keeps its existing fallback data.
                  </Text>
                )}
              </View>
            )}
          </ScrollView>

          <View style={s.actions}>
            {state !== 'done' ? (
              <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={send} disabled={state === 'sending'}>
                {state === 'sending'
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={s.btnPrimaryText}>Send step {step}</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={nextStep}>
                <Text style={s.btnPrimaryText}>Next step</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={reset}>
              <Text style={s.btnGhostText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={onClose}>
              <Text style={s.btnGhostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '92%' },
  demoBanner: { backgroundColor: '#FEF3C7', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 12 },
  demoBannerText: { fontSize: 10, fontWeight: '800', color: '#B45309', letterSpacing: 0.6, textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  sub: { fontSize: 12, color: '#64748B', marginTop: 2, marginBottom: 8 },
  section: { fontSize: 11, fontWeight: '800', color: '#475569', letterSpacing: 0.5, marginTop: 14, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#CBD5E1' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  blurb: { fontSize: 12, color: '#64748B', marginTop: 8 },
  card: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: '#F1F5F9' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { fontSize: 13, color: '#64748B' },
  rowValue: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  stamp: { fontSize: 10, color: '#94A3B8', marginTop: 8 },
  note: { fontSize: 11, color: '#94A3B8', marginTop: 12, lineHeight: 16 },
  status: { fontSize: 13, fontWeight: '600', marginTop: 4 },
  modelBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  modelTitle: { fontSize: 11, fontWeight: '800', color: '#E11082', letterSpacing: 0.5, marginBottom: 6 },
  modelLine: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  coach: { fontSize: 12, color: '#475569', marginTop: 8, fontStyle: 'italic', lineHeight: 18 },
  offline: { fontSize: 12, color: '#B45309', marginTop: 10, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: '#E11082' },
  btnPrimaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  btnGhost: { backgroundColor: '#F1F5F9' },
  btnGhostText: { color: '#334155', fontWeight: '700', fontSize: 14 },
});
