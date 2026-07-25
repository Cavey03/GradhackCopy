// src/components/VitalityScoreRing.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface VitalityScoreRingProps {
  score: number;
  isOptimal: boolean;
}

export default function VitalityScoreRing({ score, isOptimal }: VitalityScoreRingProps) {
  const size = 140;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * score) / 100;

  // Discovery Magenta for optimal recovery, Red for alert
  const ringColor = isOptimal ? '#E11082' : '#DC2626';

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background Track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress Arc */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      {/* Centered Score Display */}
      <View style={styles.scoreContainer}>
        <Text style={[styles.scoreText, { color: isOptimal ? '#002B49' : '#DC2626' }]}>
          {score}
        </Text>
        <Text style={styles.maxText}>/ 100</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    position: 'relative',
  },
  scoreContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 38,
    fontWeight: '900',
  },
  maxText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
});