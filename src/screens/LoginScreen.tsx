// src/screens/LoginScreen.tsx
import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Platform,
  KeyboardAvoidingView 
} from 'react-native';
import { ShieldCheck, ArrowRight, Database } from 'lucide-react-native';
import { fetchDashboardData, MemberNotFoundError } from '../api';

export default function LoginScreen({ navigation, route }: any) {
  const [entityNumber, setEntityNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLookup = async () => {
    const memberId = entityNumber.trim().toUpperCase();
    if (!memberId) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Real lookup: pulls the member's dashboard from DynamoDB via API Gateway.
      const initialData = await fetchDashboardData(memberId);
      navigation.replace('Dashboard', { entityNumber: memberId, initialData });
    } catch (error) {
      if (error instanceof MemberNotFoundError) {
        setErrorMsg(`No member found for "${memberId}". Try a seeded demo ID, e.g. ENT000122.`);
      } else {
        setErrorMsg('Could not reach the recovery platform. Check your connection and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.contentContainer}>
        
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.iconWrapper}>
            <ShieldCheck size={36} color="#E11082" />
          </View>
          <Text style={styles.title}>PulseGuard AI</Text>
          <Text style={styles.subtitle}>
            Enter your entity or member number to load your health telemetry and clinical baseline from the database.
          </Text>
        </View>

        {/* INPUT CARD */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Database size={18} color="#002B49" />
            <Text style={styles.cardTitle}>Dataset Lookup</Text>
          </View>

          <Text style={styles.inputLabel}>ENTITY / MEMBER NUMBER</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g., ENT000122"
            placeholderTextColor="#94A3B8"
            autoCapitalize="characters"
            autoCorrect={false}
            value={entityNumber}
            onChangeText={(text) => { setEntityNumber(text); setErrorMsg(null); }}
            editable={!isLoading}
            onSubmitEditing={handleLookup}
            returnKeyType="done"
          />

          {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, (!entityNumber.trim() || isLoading) && styles.primaryBtnDisabled]}
            disabled={!entityNumber.trim() || isLoading}
            onPress={handleLookup}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>Access Dashboard</Text>
                <ArrowRight size={18} color="#FFF" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.onboardingBtn}
            onPress={() => navigation.navigate('Onboarding')}
          >
            <Text style={styles.onboardingBtnText}>New member? Create a recovery profile</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.demoHint}>
          Demo Hint: Enter a seeded member ID (e.g. ENT000122) to pull their live profile from DynamoDB.
        </Text>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F7F9' },
  contentContainer: { flex: 1, padding: 24, justifyContent: 'center', maxWidth: 430, width: '100%', alignSelf: 'center' },
  
  header: { alignItems: 'center', marginBottom: 32 },
  iconWrapper: { width: 72, height: 72, borderRadius: 20, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#FBCFE8', ...Platform.select({ ios: { shadowColor: '#091E42', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8 }, android: { elevation: 2 } }) },
  title: { fontSize: 32, fontWeight: '900', color: '#002B49', marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 },

  card: { 
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#E2E8F0',
    ...Platform.select({ ios: { shadowColor: '#091E42', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 16 }, android: { elevation: 4 } })
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#002B49', marginLeft: 8 },
  
  inputLabel: { fontSize: 11, fontWeight: '800', color: '#94A3B8', letterSpacing: 1, marginBottom: 8 },
  textInput: { backgroundColor: '#F8FAFC', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#002B49', borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 20 },
  errorText: { fontSize: 12, color: '#DC2626', fontWeight: '600', marginTop: -12, marginBottom: 16 },
  
  primaryBtn: { backgroundColor: '#E11082', flexDirection: 'row', paddingVertical: 16, borderRadius: 14, justifyContent: 'center', alignItems: 'center', ...Platform.select({ ios: { shadowColor: '#E11082', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 }, android: { elevation: 3 } }) },
  primaryBtnDisabled: { backgroundColor: '#CBD5E1', shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  onboardingBtn: { alignItems: 'center', paddingTop: 16, paddingHorizontal: 8 },
  onboardingBtnText: { color: '#0369A1', fontSize: 12, fontWeight: '800' },

  demoHint: { textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 24, fontStyle: 'italic' },
});
