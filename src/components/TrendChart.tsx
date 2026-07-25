// src/components/TrendChart.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface TrendChartProps {
  isOptimal: boolean;
  history?: number[]; // Real recovery scores / values over time
}

export default function TrendChart({ isOptimal, history }: TrendChartProps) {
  // Use real history array if provided (e.g. [65, 70, 68, 75, 82, 80, 88]), otherwise fallback to default baseline points
  const points = (history && history.length >= 2) 
    ? history 
    : (isOptimal ? [60, 65, 70, 72, 78, 82, 88] : [75, 70, 62, 55, 48, 42, 40]);

  // Map 7 data points to SVG viewBox coordinates (width: 300, height: 80)
  const width = 300;
  const height = 80;
  const minVal = Math.min(...points, 0);
  const maxVal = Math.max(...points, 100);

  const pathCoords = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - ((val - minVal) / (maxVal - minVal || 1)) * (height - 20) - 10;
    return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  const strokeColor = isOptimal ? '#E11082' : '#DC2626';

  return (
    <View style={styles.chartContainer}>
      <Svg width="100%" height={80} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
            <Stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </LinearGradient>
        </Defs>

        <Path
          d={`${pathCoords} L ${width} ${height} L 0 ${height} Z`}
          fill="url(#grad)"
        />
        <Path
          d={pathCoords}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
        />
      </Svg>
      <View style={styles.labelRow}>
        <Text style={styles.dayLabel}>7 Days Ago</Text>
        <Text style={styles.dayLabel}>Today</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartContainer: { marginTop: 12, marginBottom: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  dayLabel: { fontSize: 10, color: '#94A3B8', fontWeight: '600' }
});