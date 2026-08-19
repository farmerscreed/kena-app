// DetailShell — Sprint 8.5 (vital-detail screens).
//
// Wraps every per-vital detail screen (BP, HR, SpO2, Sleep, Activity)
// with the shared chrome: SafeAreaView + vital-tinted background +
// DetailHeader + VitalHero slot + TimeRangePills + scrollable content
// children.
//
// API design:
//   - Render-prop pattern: consumer renders the hero block via the
//     `hero` slot (a ReactNode) and the rest of the body via children.
//   - DetailShell owns the trend-range state (`7d` / `30d` / `90d`) and
//     surfaces it via `onRangeChange` so each screen can re-fetch /
//     re-bin its data when the user picks a range. Default `7d`.
//
// Background: a subtle vital-tinted "tint at the top" effect built from
// two stacked translucent View layers — react-native-svg gradients on
// the View background aren't cross-platform, and the design's CSS
// radial-gradient doesn't have a clean RN equivalent. The two-layer
// approach is what the existing CaregiverHome warm-charcoal background
// uses (see screens/Home/CaregiverHome.tsx).
//
// Voice rules: this file ships no user-facing copy. The DetailHeader's
// vital eyebrow + the TimeRangePills' segment labels carry their own
// voice-checked strings.

import { type ReactNode, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DetailHeader } from './DetailHeader';
import { ScreenAnomalyBanner } from './ScreenAnomalyBanner';
import { TimeRangePills, type TrendRange } from './TimeRangePills';
import { useTheme } from '../theme';
import { DoctorLinkCard } from './DoctorLinkCard';
import type { VitalType } from './VitalRing';
import type { AnomalyVital } from '../state/anomalies';

function vitalForBanner(vital: VitalType): AnomalyVital | null {
  if (vital === 'bp' || vital === 'hr' || vital === 'spo2') return vital;
  return null;
}

export interface DetailShellProps {
  vital: VitalType;
  onBack: () => void;
  onMenuPress?: () => void;
  /** The hero block — typically a `<VitalHero ... />`. */
  hero: ReactNode;
  /** Initial trend-chart range. Defaults to `7d`. */
  initialRange?: TrendRange;
  /** Notified whenever the user picks a new range. */
  onRangeChange?: (range: TrendRange) => void;
  /** Detail content rendered below the range pills. */
  children?: ReactNode;
  /** Founder-test feedback (2026-08-19) — every detail page ends on
   *  the DoctorLinkCard so the export is always one obvious tap away. */
  onDoctorPress?: () => void;
  doctorPossessive?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function DetailShell({
  vital,
  onBack,
  onMenuPress,
  hero,
  initialRange = '7d',
  onRangeChange,
  children,
  testID,
  style,
  onDoctorPress,
  doctorPossessive,
}: DetailShellProps) {
  const theme = useTheme();
  const [range, setRange] = useState<TrendRange>(initialRange);
  const vitalColor = theme.colors.vital[vital];

  const handleRangeChange = (next: TrendRange) => {
    setRange(next);
    onRangeChange?.(next);
  };

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: theme.colors.surface.warmBase },
        style,
      ]}
      edges={['top', 'bottom']}
      testID={testID}
    >
      {/* Soft vital-tinted glow at the top of the screen. Two layers to
          approximate the design's radial-gradient: a wide tinted blob +
          a darker base wash. Pointer-events disabled — chrome only. */}
      <View
        pointerEvents="none"
        style={[
          styles.tint,
          {
            backgroundColor: vitalColor,
            opacity: 0.08,
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: theme.spacing.xxxxl + theme.spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <DetailHeader
          vital={vital}
          onBack={onBack}
          onMenuPress={onMenuPress}
          testID={testID ? `${testID}-header` : undefined}
        />
        {/* Sprint 15 — per-vital anomaly banner. Sleep + activity
            never produce events so this renders nothing for those
            screens. */}
        {(() => {
          const bv = vitalForBanner(vital);
          if (!bv) return null;
          return (
            <View
              style={{
                marginTop: theme.spacing.s,
                paddingHorizontal: theme.spacing.xl,
              }}
            >
              <ScreenAnomalyBanner vital={bv} />
            </View>
          );
        })()}
        <View style={{ marginTop: theme.spacing.s }}>{hero}</View>
        <View
          style={{
            marginTop: theme.spacing.s,
            paddingHorizontal: theme.spacing.xl,
          }}
        >
          <TimeRangePills
            value={range}
            onChange={handleRangeChange}
            testID={testID ? `${testID}-range` : undefined}
          />
        </View>
        <View
          style={{
            marginTop: theme.spacing.l,
            gap: theme.spacing.l,
          }}
        >
          {children}
          {onDoctorPress ? (
            <DoctorLinkCard
              onPress={onDoctorPress}
              possessive={doctorPossessive}
              testID={testID ? `${testID}-doctor` : undefined}
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 360,
  },
});
