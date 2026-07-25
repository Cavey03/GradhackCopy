import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface VitalityScoreRingProps {
  score: number;
  label?: 'REDUCE' | 'MAINTAIN' | 'PROGRESS';
  isOptimal?: boolean;
}

export const VitalityScoreRing = ({ score, label, isOptimal = true }: VitalityScoreRingProps) => {
  const ringColor =
    label === 'PROGRESS'
      ? '#10B981'
      : label === 'REDUCE'
      ? '#EF4444'
      : '#F59E0B';
  const glowColor =
    label === 'PROGRESS'
      ? 'rgba(16, 185, 129, 0.35)'
      : label === 'REDUCE'
      ? 'rgba(239, 68, 68, 0.35)'
      : 'rgba(255, 221, 163, 1)';
  const displayLabel = label ?? (isOptimal ? 'MAINTAIN' : 'REDUCE');

  // SVG Ring calculation
  const size = 160;
  const strokeWidth = 12;
  const center = size / 2;
  const radius = size / 2 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const boundedScore = Math.max(0, Math.min(100, score));
  const strokeDashoffset = circumference - (circumference * boundedScore) / 100;

  return (
    <View style={styles.container}>
      {/* 1. Ambient Background Glow built directly in */}
      <View style={[styles.glow, { backgroundColor: glowColor, shadowColor: glowColor }]} />

      {/* 2. SVG Vitality Ring */}
      <Svg width={size} height={size}>
        {/* Background Track */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Active Score Arc */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>

      {/* 3. Center Score Text */}
      <View style={styles.textContainer}>
        <Text style={styles.scoreText}>{Math.round(boundedScore)}%</Text>
        <Text style={styles.scoreLabel}>{displayLabel}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 16,
  },
  glow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 28,
    elevation: 15,
  },
  textContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 38,
    fontWeight: '900',
    color: '#002B49',
  },
  scoreLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 1.5,
  },
});

// Provides BOTH named export and default export to prevent import errors
export default VitalityScoreRing;
