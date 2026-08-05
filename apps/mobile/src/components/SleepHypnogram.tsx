// SleepHypnogram — Sprint 8.5 (vital-detail-sleep).
//
// Renders the last-night sleep stage timeline as a 4-band SVG: AWAKE on
// top → REM → LIGHT → DEEP at the bottom. Each transition becomes a
// horizontal segment at the appropriate y level; vertical connectors mark
// stage changes.
//
// Per the sprint risk note ("Sleep stage data accuracy from the watch is
// decent but not clinical. Don't surface stage data with false precision —
// broad bands only."), the timeline is intentionally binned to a fixed
// number of bands (default 30) so the visual reads as the broad shape of
// the night, not millisecond-level transitions. The pure helper
// `binTransitionsToBands` is exported for unit tests.
//
// Voice rules: every user-visible string in this file ("Stages", AWAKE /
// REM / LIGHT / DEEP, time markers) is descriptive of what the band shows,
// not predictive ("usually", "tends to") or diagnostic. No "patient",
// "diagnose", "predict", "dangerous", "critical".
//
// Stack: react-native-svg + react-native-reanimated v3, both already on
// the locked-stack list (docs/00-tech-stack.md). No new deps.

import { useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line, Rect } from 'react-native-svg';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import type { SleepSession, SleepStage, SleepTransition } from '../types/vitals';

// Bin count = 30 per design (leiko-detail-screens.jsx line 250-253) — broad
// bands, not per-minute precision.
const DEFAULT_BIN_COUNT = 30;

const CHART_WIDTH = 320;
const CHART_HEIGHT = 130;
const PAD_X = 8;
const PAD_Y = 14;
const BAND_HALF_HEIGHT = 4; // 8px tall band, drawn ±4 around the y-line

// y-fractions per stage — must mirror the design (0 / 0.25 / 0.55 / 0.85).
const STAGE_Y_FRACTION: Record<SleepStage, number> = {
  awake: 0,
  rem: 0.25,
  light: 0.55,
  deep: 0.85,
};

// Stage opacity scale (lighter = awake; darkest = deep). Single hue, four
// steps — no new color tokens introduced.
const STAGE_OPACITY: Record<SleepStage, number> = {
  awake: 0.5,
  rem: 0.7,
  light: 0.85,
  deep: 1.0,
};

// Single group fade-in window (ms). The component animates the whole
// band group through one shared opacity rather than per-band staggers,
// keeping the motion within the 1.5s budget the spec calls for even
// when bin count grows.
const FADE_DURATION_MS = 320;

// ---------------------------------------------------------------------------
// Pure helper — exported for tests
// ---------------------------------------------------------------------------

/**
 * Bins a sequence of stage transitions into `binCount` slots between
 * `sessionStartSec` and `sessionEndSec`. Each bin gets the dominant stage
 * (most overlapping seconds) of any transitions covering it. With no
 * transitions, every bin defaults to `'light'` — the most common stage.
 *
 * Pure; no theme / no clock. The component supplies the session.
 */
export function binTransitionsToBands(
  transitions: SleepTransition[],
  sessionStartSec: number,
  sessionEndSec: number,
  binCount: number = DEFAULT_BIN_COUNT,
): SleepStage[] {
  if (binCount <= 0) return [];
  if (sessionEndSec <= sessionStartSec) {
    return new Array(binCount).fill('light');
  }
  if (transitions.length === 0) {
    return new Array(binCount).fill('light');
  }

  // Sort transitions ascending; expand into [startSec, endSec, stage] segments
  // that cover the full session. Each transition holds until the next one.
  const sorted = [...transitions].sort((a, b) => a.atSec - b.atSec);
  const segments: { startSec: number; endSec: number; stage: SleepStage }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const startSec = Math.max(sorted[i].atSec, sessionStartSec);
    const nextSec = sorted[i + 1]?.atSec ?? sessionEndSec;
    const endSec = Math.min(nextSec, sessionEndSec);
    if (endSec <= startSec) continue;
    segments.push({ startSec, endSec, stage: sorted[i].stage });
  }

  // If the first transition starts after sessionStartSec, fill the gap
  // with the same first stage. (Watch sometimes drops the very first
  // transition; the visual should still cover the full session.)
  if (segments.length > 0 && segments[0].startSec > sessionStartSec) {
    segments.unshift({
      startSec: sessionStartSec,
      endSec: segments[0].startSec,
      stage: segments[0].stage,
    });
  }
  if (segments.length === 0) {
    return new Array(binCount).fill('light');
  }

  const totalSec = sessionEndSec - sessionStartSec;
  const binSec = totalSec / binCount;
  const out: SleepStage[] = [];

  for (let i = 0; i < binCount; i++) {
    const binStart = sessionStartSec + i * binSec;
    const binEnd = sessionStartSec + (i + 1) * binSec;
    // Tally seconds of overlap per stage in this bin.
    const tally: Record<SleepStage, number> = {
      awake: 0,
      rem: 0,
      light: 0,
      deep: 0,
    };
    for (const seg of segments) {
      const overlap = Math.max(
        0,
        Math.min(binEnd, seg.endSec) - Math.max(binStart, seg.startSec),
      );
      if (overlap > 0) tally[seg.stage] += overlap;
    }
    // Dominant stage = highest tally. Tie-break order: deep > rem > light > awake
    // (the lower-prevalence "interesting" stages win ties so the visual
    // foregrounds them).
    const ordered: SleepStage[] = ['deep', 'rem', 'light', 'awake'];
    let pick: SleepStage = 'light';
    let best = -1;
    for (const stage of ordered) {
      if (tally[stage] > best) {
        best = tally[stage];
        pick = stage;
      }
    }
    out.push(pick);
  }
  return out;
}

/** Format a unix-sec moment as e.g. "11:14 pm". */
function formatClock(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Compact time marker, e.g. "11p", "3a", "7a". */
function formatMarker(sec: number): string {
  const d = new Date(sec * 1000);
  const h = d.getHours();
  const ampm = h < 12 ? 'a' : 'p';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${ampm}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SleepHypnogramProps {
  session: SleepSession;
  /** Override for tests; defaults to 30 broad bins per the design. */
  binCount?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const STAGE_LABELS: SleepStage[] = ['awake', 'rem', 'light', 'deep'];

export function SleepHypnogram({
  session,
  binCount = DEFAULT_BIN_COUNT,
  testID,
  style,
}: SleepHypnogramProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');
  const sleepColor = theme.colors.vital.sleep;

  const bands = useMemo(
    () =>
      binTransitionsToBands(
        session.transitions,
        session.sessionStartSec,
        session.sessionEndSec,
        binCount,
      ),
    [session.transitions, session.sessionStartSec, session.sessionEndSec, binCount],
  );

  // Fade the whole band group in over a single window. Per-band staggering
  // would overflow the 1.5s budget when bin counts grow; the group fade
  // keeps the motion calm and within budget.
  const opacityValue = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      opacityValue.value = 1;
      return;
    }
    opacityValue.value = 0;
    opacityValue.value = withTiming(1, {
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
    });
  }, [reduceMotion, opacityValue, bands.length]);

  const animatedGroupStyle = useAnimatedStyle(() => ({
    opacity: opacityValue.value,
  }));

  const innerW = CHART_WIDTH - PAD_X * 2;
  const innerH = CHART_HEIGHT - PAD_Y * 2;
  const sliceW = bands.length > 0 ? innerW / bands.length : 0;

  const startLabel = formatClock(session.sessionStartSec);
  const endLabel = formatClock(session.sessionEndSec);
  const eyebrow = `Stages · ${startLabel} – ${endLabel}`;

  const startMarker = formatMarker(session.sessionStartSec);
  const midMarker = formatMarker(
    Math.floor((session.sessionStartSec + session.sessionEndSec) / 2),
  );
  const endMarker = formatMarker(session.sessionEndSec);

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <Text
        accessibilityRole="header"
        allowFontScaling={false}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          marginHorizontal: 24,
          marginBottom: 10,
        }}
        testID={testID ? `${testID}-eyebrow` : undefined}
      >
        {eyebrow}
      </Text>
      <View
        // Audit P1-6 — `accessible` added explicitly. A View carrying a
        // composed accessibilityLabel without it is not guaranteed to be
        // exposed as a single element on iOS, which would silence the label.
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Sleep stages from ${startLabel} to ${endLabel}.`}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface.warmSubtle,
            borderColor: theme.colors.border.rim,
            borderRadius: theme.radii.l,
            padding: theme.spacing.l,
          },
        ]}
        testID={testID ? `${testID}-card` : undefined}
      >
        <Svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          testID={testID ? `${testID}-svg` : undefined}
        >
          {/* Stage labels (left edge). Native SVG <Text> on RN doesn't honour
              every web text feature, so we render labels as RN <Text> in an
              overlay below — the SVG keeps just the bands and connectors. */}

          {bands.map((stage, i) => {
            const y = PAD_Y + STAGE_Y_FRACTION[stage] * innerH;
            const opacity = STAGE_OPACITY[stage];
            return (
              <Rect
                key={`b-${i}`}
                x={PAD_X + i * sliceW}
                y={y - BAND_HALF_HEIGHT}
                width={Math.max(0, sliceW - 0.5)}
                height={BAND_HALF_HEIGHT * 2}
                rx={2}
                fill={sleepColor}
                fillOpacity={opacity}
                testID={testID ? `${testID}-bin-${i}` : undefined}
              />
            );
          })}
          {bands.map((stage, i) => {
            if (i >= bands.length - 1) return null;
            const next = bands[i + 1];
            if (next === stage) return null;
            const y = PAD_Y + STAGE_Y_FRACTION[stage] * innerH;
            const ny = PAD_Y + STAGE_Y_FRACTION[next] * innerH;
            return (
              <Line
                key={`c-${i}`}
                x1={PAD_X + (i + 1) * sliceW}
                y1={y}
                x2={PAD_X + (i + 1) * sliceW}
                y2={ny}
                stroke={sleepColor}
                strokeOpacity={STAGE_OPACITY[next] * 0.7}
                strokeWidth={1.5}
              />
            );
          })}
        </Svg>

        {/* Stage labels — overlayed RN text so font tokens apply cleanly. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {STAGE_LABELS.map((stage) => {
            // Each label sits at its band's y, offset for the card padding.
            const yPx =
              theme.spacing.l +
              PAD_Y +
              STAGE_Y_FRACTION[stage] * innerH -
              5;
            return (
              <Text
                key={`l-${stage}`}
                allowFontScaling={false}
                style={{
                  position: 'absolute',
                  top: yPx,
                  left: theme.spacing.l + PAD_X,
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: 8,
                  letterSpacing: 0.8,
                  color: theme.colors.text.tertiary,
                }}
                testID={testID ? `${testID}-label-${stage}` : undefined}
              >
                {stage.toUpperCase()}
              </Text>
            );
          })}
        </View>

        {/* Time markers (start, mid, end). Below the chart. */}
        <View style={styles.markersRow}>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: captionStyle.size,
              color: theme.colors.text.tertiary,
              letterSpacing: 0.6,
            }}
          >
            {startMarker}
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: captionStyle.size,
              color: theme.colors.text.tertiary,
              letterSpacing: 0.6,
            }}
          >
            {midMarker}
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: captionStyle.size,
              color: theme.colors.text.tertiary,
              letterSpacing: 0.6,
            }}
          >
            {endMarker}
          </Text>
        </View>

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, animatedGroupStyle]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // outer wrap — eyebrow + card
  },
  card: {
    marginHorizontal: 20,
    borderWidth: 0.5,
    position: 'relative',
  },
  markersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
});

