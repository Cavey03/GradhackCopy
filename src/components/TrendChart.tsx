import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface ChartProps {
  isOptimal: boolean;
}

export default function TrendChart({ isOptimal }: ChartProps) {
  // Mock 7-day trend data (Recovery scores out of 100)
  const optimalTrend = [72, 78, 65, 80, 82, 85, 85];
  const warningTrend = [78, 70, 62, 55, 50, 45, 48];

  const data = isOptimal ? optimalTrend : warningTrend;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <View style={styles.chartContainer}>
      <View style={styles.barRow}>
        {data.map((value, index) => {
          const isToday = index === data.length - 1;
          const barHeight = (value / 100) * 80; // Scale to max 80px height

          return (
            <View key={index} style={styles.column}>
              <Text style={styles.valueLabel}>{value}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: barHeight,
                      backgroundColor: isToday
                        ? isOptimal ? '#16A34A' : '#DC2626'
                        : '#CBD5E1',
                    },
                  ]}
                />
              </View>
              <Text style={[styles.dayLabel, isToday && styles.todayLabel]}>
                {days[index]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartContainer: {
    marginTop: 12,
    paddingTop: 8,
  },
  barRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 110,
  },
  column: {
    alignItems: 'center',
    flex: 1,
  },
  valueLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
  },
  barTrack: {
    width: 14,
    height: 80,
    backgroundColor: '#F1F5F9',
    borderRadius: 7,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 7,
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 6,
  },
  todayLabel: {
    color: '#002B49',
    fontWeight: '800',
  },
});