// src/screens/SimulatorScreen.tsx
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Platform,
  KeyboardAvoidingView 
} from 'react-native';
import { Sparkles, ArrowLeft, ShieldCheck, AlertTriangle, Send, CheckCircle2, XCircle, AlertCircle } from 'lucide-react-native';
import { evaluateActivity } from '../api';
import WearableSimulatorModal from '../components/WearableSimulatorModal';

export default function SimulatorScreen({ navigation, route }: any) {
  const entityNumber = route?.params?.entityNumber || 'ENT000122';
  const [wearableDemoVisible, setWearableDemoVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Quick preset questions for a fast, foolproof demo click
  const presetQuestions = [
    "Can I play my band's live rock performance tonight?",
    "Am I allowed to do heavy squats at the gym?",
    "Can I go for a 5km high-intensity run?",
    "Should I push through my fatigue or rest today?"
  ];

  const handleEvaluateQuery = async (selectedText?: string) => {
    const textToEvaluate = selectedText || query;
    if (!textToEvaluate.trim()) return;

    setLoading(true);
    setResult(null);

    // Ask the backend simulation endpoint; fall back to local heuristics offline
    const verdict = await evaluateActivity(entityNumber, textToEvaluate);
    setLoading(false);

    if (verdict) {
      setResult({ question: textToEvaluate, dataSource: 'LIVE_API', ...verdict });
      return;
    }

    if (!MOCK_FALLBACK_ENABLED) {
      setResult({
        question: textToEvaluate,
        dataSource: 'ERROR',
        status: 'warning',
        title: 'LIVE ANALYSIS UNAVAILABLE',
        summary: 'The AWS simulation endpoint could not be reached. No local result has been substituted.',
        bedrockRationale: '',
      });
      return;
    }

    const lower = textToEvaluate.toLowerCase();
    let status = 'approved';
    let title = 'APPROVED';
    let summary = '';

    if (lower.includes('band') || lower.includes('performance') || lower.includes('heavy') || lower.includes('run')) {
      status = 'warning';
      title = 'MODIFIED PROTOCOL RECOMMENDED';
      summary = 'Autonomic baseline indicates moderate recovery debt. You may participate, but cap exertion at 70% intensity and hydrate aggressively.';
    } else {
      status = 'approved';
      title = 'SAFE TO PROCEED';
      summary = 'Parasympathetic tone is dominant and rMSSD values are optimal. Your physiological markers support this activity.';
    }

    setResult({
      question: textToEvaluate,
      dataSource: 'MOCK_FALLBACK',
      status,
      title,
      summary,
      bedrockRationale: 'Local demo logic generated this example result. It was not returned by AWS or a prediction model.'
    });
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.contentContainer}>
        
        {/* CUSTOM HEADER */}
        <View style={styles.customHeader}>
          <TouchableOpacity 
            style={styles.backBtn} 
            onPress={() => navigation.goBack()}
          >
            <ArrowLeft size={20} color="#002B49" />
          </TouchableOpacity>
          <View>
            <Text style={styles.navTitle}>AI Capability Check</Text>
            <Text style={styles.navSub}>Ask what you're allowed to do today</Text>
          </View>
        </View>

        {/* PRESENTER TOOL: step the wearable trend and watch the pipeline respond */}
        <TouchableOpacity
          style={demoBtn.button}
          onPress={() => setWearableDemoVisible(true)}
        >
          <Text style={demoBtn.text}>▶  Recovery Trend Simulator (Demo)</Text>
        </TouchableOpacity>

        <WearableSimulatorModal
          visible={wearableDemoVisible}
          onClose={() => setWearableDemoVisible(false)}
          memberId={entityNumber}
        />

        {/* INPUT CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Sparkles size={16} color="#E11082" />
            <Text style={styles.cardTitle}>WHAT ARE YOU PLANNING?</Text>
          </View>

          <TextInput
            style={styles.textInput}
            placeholder="e.g., Can I perform at my gig tonight?"
            placeholderTextColor="#94A3B8"
            value={query}
            onChangeText={setQuery}
            editable={!loading}
            multiline
          />

          <TouchableOpacity 
            style={[styles.primaryBtn, (!query.trim() || loading) && styles.primaryBtnDisabled]}
            disabled={!query.trim() || loading}
            onPress={() => handleEvaluateQuery()}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>Query Bedrock AI</Text>
                <Send size={16} color="#FFF" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* QUICK DEMO PILLS */}
        <Text style={styles.sectionLabel}>QUICK PITCH DEMO PROMPTS</Text>
        <View style={styles.pillsContainer}>
          {presetQuestions.map((item, index) => (
            <TouchableOpacity 
              key={index} 
              style={styles.pill}
              onPress={() => {
                setQuery(item);
                handleEvaluateQuery(item);
              }}
            >
              <Text style={styles.pillText}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* RESULT CARD */}
        {result && (
          <View style={[styles.resultCard, result.status === 'warning' ? styles.warningBorder : styles.successBorder]}>
            {result.dataSource !== 'LIVE_API' && (
              <View style={styles.sourceWarning}>
                <AlertTriangle size={14} color="#92400E" />
                <Text style={styles.sourceWarningText}>
                  {result.dataSource === 'MOCK_FALLBACK'
                    ? 'DEMO RESULT — NOT LIVE AWS DATA'
                    : 'LIVE AWS RESULT UNAVAILABLE'}
                </Text>
              </View>
            )}
            <View style={styles.resultHeader}>
              {result.status === 'warning' ? (
                <AlertCircle size={22} color="#DC2626" />
              ) : (
                <CheckCircle2 size={22} color="#16A34A" />
              )}
              <Text style={[styles.resultTitle, { color: result.status === 'warning' ? '#DC2626' : '#16A34A' }]}>
                {result.title}
              </Text>
            </View>

            <Text style={styles.targetQueryLabel}>Query: "{result.question}"</Text>
            <Text style={styles.resultSummary}>{result.summary}</Text>

            {result.bedrockRationale ? (
              <View style={styles.bedrockBox}>
                <Text style={styles.bedrockTitle}>
                  {result.dataSource === 'LIVE_API'
                    ? 'Recovery Model Comparison'
                    : 'Local Demo Rationale'}
                </Text>
                <Text style={styles.bedrockText}>{result.bedrockRationale}</Text>
              </View>
            ) : null}
          </View>
        )}

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Kept separate from `styles` so the demo tool can be lifted out cleanly.
const demoBtn = StyleSheet.create({
  button: {
    backgroundColor: '#FEF3C7', borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 16, marginBottom: 16, borderWidth: 1, borderColor: '#FDE68A',
  },
  text: { color: '#B45309', fontWeight: '800', fontSize: 13, textAlign: 'center' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F7F9' },
  contentContainer: { padding: 16, maxWidth: 430, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  
  customHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', marginRight: 12 },
  navTitle: { fontSize: 18, fontWeight: '900', color: '#002B49', letterSpacing: -0.3 },
  navSub: { fontSize: 12, color: '#64748B', marginTop: 2 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: '#E2E8F0', ...Platform.select({ ios: { shadowColor: '#091E42', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 }, android: { elevation: 4 } }) },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 1, marginLeft: 6 },
  
  textInput: { backgroundColor: '#F8FAFC', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#002B49', borderWidth: 1, borderColor: '#E2E8F0', height: 90, textAlignVertical: 'top', marginBottom: 16 },
  
  primaryBtn: { backgroundColor: '#E11082', flexDirection: 'row', paddingVertical: 14, borderRadius: 14, justifyContent: 'center', alignItems: 'center', ...Platform.select({ ios: { shadowColor: '#E11082', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 }, android: { elevation: 3 } }) },
  primaryBtnDisabled: { backgroundColor: '#CBD5E1', shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#94A3B8', letterSpacing: 1, marginBottom: 10, marginLeft: 4 },
  pillsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  pill: { backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#002B49' },

  resultCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, borderWidth: 1, ...Platform.select({ ios: { shadowColor: '#091E42', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12 }, android: { elevation: 4 } }) },
  successBorder: { borderColor: '#BBF7D0' },
  warningBorder: { borderColor: '#FECACA' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  resultTitle: { fontSize: 15, fontWeight: '900', marginLeft: 8, letterSpacing: -0.2 },
  targetQueryLabel: { fontSize: 12, fontStyle: 'italic', color: '#64748B', marginBottom: 8 },
  resultSummary: { fontSize: 14, color: '#334155', fontWeight: '500', lineHeight: 22, marginBottom: 16 },
  sourceWarning: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 10, padding: 9, marginBottom: 12 },
  sourceWarningText: { color: '#92400E', fontSize: 10, fontWeight: '900', letterSpacing: 0.5, marginLeft: 6 },
  
  bedrockBox: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#F1F5F9' },
  bedrockTitle: { fontSize: 11, fontWeight: '800', color: '#E11082', marginBottom: 4, letterSpacing: 0.5 },
  bedrockText: { fontSize: 12, color: '#475569', lineHeight: 18 },
});
