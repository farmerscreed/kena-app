// SleepStagesBar — Sprint 16.5c (replaces SleepHypnogram for the U16PRO
// firmware, which doesn't expose per-minute stage transitions over BLE).
//
// The 0x07 sleep packet from this watch model carries only total /
// deep / light durations (per U16PRO_protocol_en.pdf §4.3). REM and
// awake periods are not reported, and there's no hypnogram timeline.
// The earlier SleepHypnogram component expected a `transitions[]`
// array and, when it found none (always the case here), fell back to
// painting every bin as "light" — rendering as a flat blank band.
//
// This component drops that pretence. It shows a single horizontal
// stacked bar with three segments — Deep / Light / Other — sized by
// the actual reported minutes. "Other" is `total - deep - light`,
// which on a healthy night captures REM cycles + brief awakings + any
// time the watch couldn't classify. We label it honestly, not as
// "REM" we don't have. A small caption below the bar explains.
//
// Voice rules: descriptive only. No "patient", "diagnose", "predict",
// "dangerous", "critical". Calm framing.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { formatClockInTz, useUserTz } from '../utils/userTz';

export interface SleepStagesBarProps {
  totalMinutes: number;
  deepMinutes: number;
  lightMinutes: number;
  /** Optional override for the "Other" minutes. Defaults to
   *  `total - deep - light`, clamped to 0. */
  otherMinutes?: number;
  /** Unix-sec when the user fell asleep. Renders prominently in the
   *  header as "11:14 pm → 8:00 am". */
  sessionStartSec?: number;
  /** Unix-sec when the user woke up. */
  sessionEndSec?: number;
  /** Sprint 18 — provenance of the session's wake/bed times.
   *  'fallback' surfaces an "approx." caption under the Woke chip so
   *  the user knows the watch's HR data wasn't sufficient to pin
   *  the actual wake moment. Undefined behaves like 'fallback' for
   *  display purposes but is silent (legacy rows pre-Sprint-18). */
  wakeSource?: 'hr_inferred' | 'fallback';
  /** Sprint 18 — IANA timezone for clock formatting. Optional; when
   *  omitted, falls back to `useUserTz()` (profile → device-OS). */
  tz?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function formatHm(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

export function SleepStagesBar({
  totalMinutes,
  deepMinutes,
  lightMinutes,
  otherMinutes,
  sessionStartSec,
  sessionEndSec,
  wakeSource,
  tz,
  testID,
  style,
}: SleepStagesBarProps) {
  const theme = useTheme();
  // Tz resolution order: explicit prop → user profile → device OS.
  // The hook is unconditionally called so React's rules of hooks hold;
  // `tz` prop overrides when supplied (tests / explicit callers).
  const resolvedTz = useUserTz();
  const effectiveTz = tz ?? resolvedTz;
  const formatClock = (sec: number): string => formatClockInTz(sec, effectiveTz);
  const sleepColor = theme.colors.vital.sleep;
  const otherFinal = otherMinutes ?? Math.max(0, totalMinutes - deepMinutes - lightMinutes);
  const deepPct = pct(deepMinutes, totalMinutes);
  const lightPct = pct(lightMinutes, totalMinutes);
  const otherPct = Math.max(0, 100 - deepPct - lightPct);

  const labelStyle = theme.type('labelUppercase');
  const valueStyle = theme.type('numericS');
  const titleStyle = theme.type('title');
  const captionStyle = theme.type('caption');

  // Honesty rule (data-completeness fix): the watch never records bed/wake
  // times. We only show a clock window when HR (the morning surge) let us
  // infer it with confidence; for 'fallback' / undefined we show NO times
  // (the duration total above stands on its own) rather than a fabricated
  // clock. The window is always framed as an estimate.
  const hasWindow =
    wakeSource === 'hr_inferred' &&
    typeof sessionStartSec === 'number' &&
    typeof sessionEndSec === 'number' &&
    sessionEndSec > sessionStartSec;

  // Single-hue, three-step opacity ramp so the bar reads as one
  // material instead of three colours fighting for attention.
  const segments: Array<{
    key: 'deep' | 'light' | 'other';
    label: string;
    minutes: number;
    percentLabel: number;
    opacity: number;
  }> = [
    { key: 'deep', label: 'Deep', minutes: deepMinutes, percentLabel: deepPct, opacity: 1.0 },
    { key: 'light', label: 'Light', minutes: lightMinutes, percentLabel: lightPct, opacity: 0.7 },
    { key: 'other', label: 'Other', minutes: otherFinal, percentLabel: otherPct, opacity: 0.4 },
  ];

  return (
    <View
      style={[
        {
          marginHorizontal: theme.spacing.xl,
          padding: theme.spacing.l,
          borderRadius: theme.radii.l,
          backgroundColor: theme.colors.surface.warmSubtle,
          borderWidth: 0.5,
          borderColor: theme.colors.border.rim,
          gap: theme.spacing.m,
        },
        style,
      ]}
      testID={testID}
    >
      <View style={styles.headerRow}>
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: labelStyle.family,
            fontSize: labelStyle.size,
            lineHeight: labelStyle.lineHeight,
            letterSpacing: labelStyle.letterSpacing,
            color: theme.colors.text.tertiary,
            textTransform: 'uppercase',
          }}
        >
          Sleep composition
        </Text>
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: captionStyle.size,
            lineHeight: captionStyle.lineHeight,
            color: theme.colors.text.tertiary,
            letterSpacing: 0.3,
          }}
        >
          {formatHm(totalMinutes)} total
        </Text>
      </View>

      {/* Sleep window — bedtime → wake-time in the vital colour so it
          reads at a glance. Pre-16.5c this lived as a faded sub-line
          inside the hero; the user couldn't find it. */}
      {hasWindow ? (
        <View style={styles.windowRow}>
          <View style={styles.windowCol}>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: labelStyle.family,
                fontSize: labelStyle.size,
                lineHeight: labelStyle.lineHeight,
                letterSpacing: labelStyle.letterSpacing,
                color: theme.colors.text.tertiary,
                textTransform: 'uppercase',
              }}
            >
              In bed
            </Text>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontVariant: ['tabular-nums'],
                fontSize: titleStyle.size,
                lineHeight: titleStyle.lineHeight,
                color: sleepColor,
                fontWeight: '600',
              }}
            >
              {formatClock(sessionStartSec!)}
            </Text>
          </View>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: titleStyle.family,
              fontSize: titleStyle.size,
              lineHeight: titleStyle.lineHeight,
              color: theme.colors.text.tertiary,
              alignSelf: 'flex-end',
              paddingBottom: 2,
            }}
          >
            →
          </Text>
          <View style={[styles.windowCol, { alignItems: 'flex-end' }]}>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: labelStyle.family,
                fontSize: labelStyle.size,
                lineHeight: labelStyle.lineHeight,
                letterSpacing: labelStyle.letterSpacing,
                color: theme.colors.text.tertiary,
                textTransform: 'uppercase',
              }}
            >
              Woke
            </Text>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontVariant: ['tabular-nums'],
                fontSize: titleStyle.size,
                lineHeight: titleStyle.lineHeight,
                color: sleepColor,
                fontWeight: '600',
              }}
            >
              {formatClock(sessionEndSec!)}
            </Text>
            {/* The window only renders for hr_inferred, and an inferred
                wake is still an estimate — label it honestly. */}
            <Text
              allowFontScaling={false}
              testID={testID ? `${testID}-estimate` : undefined}
              style={{
                fontFamily: captionStyle.family,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
                fontStyle: 'italic',
              }}
            >
              est. from heart rate
            </Text>
          </View>
        </View>
      ) : null}

      {/* The bar itself — three flexed segments. */}
      <View
        style={styles.bar}
        // Audit P1-6 — `accessible` added explicitly. A View carrying a
        // composed accessibilityLabel without it is not guaranteed to be
        // exposed as a single element on iOS, which would silence the label.
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Deep ${deepPct}%, Light ${lightPct}%, Other ${otherPct}%`}
      >
        {segments.map((seg, i) =>
          seg.percentLabel > 0 ? (
            <View
              key={seg.key}
              style={{
                flex: seg.percentLabel,
                backgroundColor: sleepColor,
                opacity: seg.opacity,
                marginLeft: i === 0 ? 0 : 1,
              }}
              testID={testID ? `${testID}-segment-${seg.key}` : undefined}
            />
          ) : null,
        )}
      </View>

      {/* Legend rows — three columns. */}
      <View style={styles.legend}>
        {segments.map((seg) => (
          <View key={seg.key} style={styles.legendCol}>
            <View style={styles.legendDotRow}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: sleepColor, opacity: seg.opacity },
                ]}
              />
              <Text
                allowFontScaling={false}
                style={{
                  fontFamily: labelStyle.family,
                  fontSize: labelStyle.size,
                  lineHeight: labelStyle.lineHeight,
                  letterSpacing: labelStyle.letterSpacing,
                  color: theme.colors.text.tertiary,
                  textTransform: 'uppercase',
                }}
              >
                {seg.label}
              </Text>
            </View>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: valueStyle.family,
                fontSize: valueStyle.size,
                lineHeight: valueStyle.lineHeight,
                color: theme.colors.text.primary,
                fontWeight: '600',
              }}
            >
              {formatHm(seg.minutes)}
            </Text>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: captionStyle.size,
                lineHeight: captionStyle.lineHeight,
                color: theme.colors.text.tertiary,
              }}
            >
              {seg.percentLabel}%
            </Text>
          </View>
        ))}
      </View>

      <Text
        allowFontScaling={false}
        style={{
          fontFamily: captionStyle.family,
          fontSize: captionStyle.size,
          lineHeight: captionStyle.lineHeight,
          color: theme.colors.text.tertiary,
        }}
      >
        Your watch reports total, deep, and light durations per night. Minute-by-minute REM and awake timing aren't available on this model — "Other" covers REM cycles and brief wakings combined.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  windowCol: {
    gap: 2,
  },
  bar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  legend: {
    flexDirection: 'row',
    gap: 12,
  },
  legendCol: {
    flex: 1,
    gap: 4,
  },
  legendDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
