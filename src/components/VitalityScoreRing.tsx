import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface VitalityScoreRingProps {
  score: number;
  isOptimal?: boolean;
}

export const VitalityScoreRing = ({ score, isOptimal = true }: VitalityScoreRingProps) => {
  // Ambient Glow & Ring Color based on score threshold
  const glowColor =
    score >= 75
      ? 'rgba(16, 185, 129, 0.35)' // Soft Emerald
      : score >= 50
      ? 'rgba(255, 221, 163, 1)' // Soft Amber
      : 'rgba(239, 68, 68, 0.35)';  // Soft Red Warning

  const ringColor = score >= 75 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';

  // SVG Ring calculation
  const size = 160;
  const strokeWidth = 12;
  const center = size / 2;
  const radius = size / 2 - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * score) / 100;

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
        <Text style={styles.scoreText}>{score}</Text>
        <Text style={styles.scoreLabel}>VITALITY</Text>
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