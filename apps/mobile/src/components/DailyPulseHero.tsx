// DailyPulseHero — D12 §11.2.3 + D13 §7 (Sprint 7.6, redesigned 2026-05-08
// against `leiko-constellation.jsx` from the design bundle after on-device
// review).
//
// The signature component of the app. Replaces the earlier 5-concentric-
// ring stack with the actual constellation layout from the design source:
//
//   - One LARGE central ring (BP) carrying the headline value.
//   - FOUR satellite rings arranged on a curved arc above the central
//     ring (HR upper-left · SpO2 upper-left-mid · Sleep upper-right-mid ·
//     Activity upper-right). Each satellite shows its own value + unit
//     inside its ring.
//   - Faint dashed connector lines from each satellite to the BP edge,
//     so the cluster reads as a constellation map.
//   - An ambient breathing glow under the central ring.
//
// Why the rebuild: the concentric stack we shipped first failed the
// "can a stranger glance at this and know" test — five rings stacked at
// progressively smaller diameters didn't communicate which value was
// which, and only the outermost (BP) had room for a number. The
// constellation layout below gives every vital its own home + label.
//
// API:
//   - `vitals` carries five `DailyPulseHeroVital` shapes — each has
//     `fill` (arc 0..1), `display` (pre-formatted value), `unit`
//     (mono uppercase caption inside the ring), and optional `live`.
//   - `central` is the BP block (label + value + sub + live). Per D13
//     §7.2 the caller may also pass an adapted central — e.g. when BP
//     is absent and the cascade resolves to HR. The hero renders
//     whatever `central` carries inside the BP ring; the BP ring's
//     own fill always reflects the BP tier per D13 §7.1.
//   - `onSelectVital` fires when a ring is tapped, with the
//     VitalType string.
//
// Reduced motion (D12 §7.4): every animation gates on useReducedMotion.
// The dashed connector lines and ambient glow render statically; rings
// fill instantly with no stagger; the live-pulse worklet is bypassed.

import { useEffect, type ReactNode } from 'react';
import {
  Pressable,
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
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import { VitalRing, type VitalRingState, type VitalType } from './VitalRing';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import { opacity } from '../theme/tokens';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
// Sprint 19 (audit P1-5) — the verdict under the hero value comes from
// the SAME helper BPDetail and HRDetail use. Do not re-coin it here.
import {
  vitalRangeCopyForTier,
  type ClassificationTier,
  type Tier,
} from '../utils/classification';
import {
  dailyPulseRevealNarrationOpacity,
  dailyPulseRevealOpacity,
} from '../theme/motion/patterns';

export interface DailyPulseHeroVital {
  /** Arc fraction 0..1 — see D13 §7.1 fill formulas. */
  fill: number;
  /** Pre-formatted display value ("122", "64", "98", "7:42", "4,166"). */
  display: string;
  /** Mono uppercase unit caption ("bpm", "%", "hrs", "steps"). */
  unit: string;
  /** When true, the ring runs the live-pulse worklet. Only one vital
   *  should be live at a time; the consumer decides which. */
  live?: boolean;
  /** Optional explicit ring state — overrides `live` when supplied. */
  state?: VitalRingState;
}

export interface DailyPulseHeroVitals {
  bp: DailyPulseHeroVital;
  hr: DailyPulseHeroVital;
  spo2: DailyPulseHeroVital;
  sleep: DailyPulseHeroVital;
  activity: DailyPulseHeroVital;
}

export interface DailyPulseHeroCentral {
  /** Mono uppercase eyebrow above the giant value ("Blood pressure", "Resting HR"). */
  label: string;
  /** Pre-formatted giant value ("122/78", "64", "7:42", "—"). */
  value: string;
  /** Mono caption below the value ("6:42 am", "resting", "last night"). */
  sub?: string;
  /**
   * Unit for the verdict line under the ring ("mmHg", "bpm").
   *
   * Sprint 19 (audit P1-5). Combined with `tier` through the shared
   * `vitalRangeCopyForTier`, so the biggest number in the app carries
   * the same interpretation the detail screens show. With no `tier` the
   * helper yields the bare unit — we say nothing rather than guess.
   */
  unit?: string;
  /**
   * Classification tier for the central value. Callers pass this ONLY
   * when the tier actually describes the value on screen — i.e. when the
   * D13 §7.2 cascade resolved to BP. The HR / sleep fallbacks have no
   * verdict of their own, so they leave it undefined.
   */
  tier?: ClassificationTier | null;
  /**
   * D13 PR-4 — verdict-aware tier. When 'learning' the central ring
   * renders the grey learning colour and the verdict line says so in
   * the §7.4 fragment; the legacy `tier` alone cannot express it.
   */
  canonicalTier?: Tier | null;
  /** When true, a small "live" pill renders below the sub. */
  live?: boolean;
}

export interface DailyPulseHeroProps {
  vitals: DailyPulseHeroVitals;
  /** What to render inside the central ring. Caller composes via the
   *  D13 §7.2 priority cascade (BP fresh ≤8h → HR ≤12h → sleep → "—"). */
  central: DailyPulseHeroCentral;
  /** Optional AI narration sentence rendered under the constellation. */
  aiNarration?: string;
  /** Used in the composed accessibilityLabel ("Daily pulse for {parentName}"). */
  parentName?: string;
  /** Fires when a ring is tapped — the consumer routes to that vital's
   *  detail screen. */
  onSelectVital?: (vital: VitalType) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Layout constants — match the design's polar-coordinate placements.
// `cx` / `cy` are the BP ring's centre inside the SVG canvas.
// ---------------------------------------------------------------------------

const CANVAS_W = 360;
const CANVAS_H = 380;
const BP_CX = CANVAS_W / 2;
const BP_CY = 230;
const BP_DIAMETER = 220;
const BP_STROKE = 9;
// Sprint 19 (audit P1-5) — the verdict line sits in the dead space
// between the BP ring's lower edge (BP_CY + BP_DIAMETER / 2 = 340) and
// the canvas bottom (380). Full canvas width, so "mmHg · within your
// usual range" fits on one line — inside the ring, the chord at that
// height is only ~150pt and would have wrapped it over the stroke.
const VERDICT_TOP = BP_CY + BP_DIAMETER / 2 + 8;
const STAGGER_MS = 80;
const OPACITY_REVEAL_MS = 200; // duration.normal — see motion/patterns.ts
const GLOW_BREATHE_DURATION_MS = 4500;
/**
 * Rendered opacity of the ambient glow disc behind the BP ring. Sourced
 * from the shared opacity tokens — see the rationale and contrast
 * ceiling documented on `opacity.glowRest` / `opacity.glowPeak`.
 */
const GLOW_OPACITY_REST = opacity.glowRest;
const GLOW_OPACITY_PEAK = opacity.glowPeak;
const GLOW_OPACITY_STATIC = opacity.glowStatic;

interface SatelliteDef {
  vital: 'hr' | 'spo2' | 'sleep' | 'activity';
  /** Polar angle (deg from horizontal, CCW). */
  deg: number;
  /** Polar distance from BP centre (pt). */
  dist: number;
  /** Ring diameter (pt). */
  size: number;
  /** Inner stroke width (pt). */
  stroke: number;
}

const SATELLITES: SatelliteDef[] = [
  { vital: 'hr',       deg: 152, dist: 158, size: 78, stroke: 4 }, // upper-left
  { vital: 'spo2',     deg: 118, dist: 168, size: 64, stroke: 4 }, // upper-left-mid
  { vital: 'sleep',    deg: 62,  dist: 168, size: 64, stroke: 4 }, // upper-right-mid
  { vital: 'activity', deg: 28,  dist: 158, size: 78, stroke: 4 }, // upper-right
];

const VITAL_HUMAN_NAME: Record<VitalType, string> = {
  bp: 'Blood pressure',
  hr: 'Heart rate',
  spo2: 'Oxygen',
  sleep: 'Sleep',
  activity: 'Activity',
};

interface SatellitePosition {
  /** Top-left x for a `size`×`size` square so the ring centres on the polar point. */
  left: number;
  /** Top-left y for the satellite. */
  top: number;
  /** Centre x (used for the connector line). */
  cx: number;
  /** Centre y. */
  cy: number;
}

/**
 * Polar → rect for one satellite. `deg` is measured CCW from horizontal,
 * matching the design source. `cy` decreases upward in screen coordinates,
 * so we subtract `sin` from `cy`.
 *
 * Exported for unit-tests so the geometry stays pinnable without
 * mounting the component.
 */
export function satellitePosition(def: SatelliteDef): SatellitePosition {
  const a = (def.deg * Math.PI) / 180;
  const cx = BP_CX + Math.cos(a) * def.dist;
  const cy = BP_CY - Math.sin(a) * def.dist;
  return {
    left: cx - def.size / 2,
    top: cy - def.size / 2,
    cx,
    cy,
  };
}

/**
 * Endpoint on the BP ring's edge for a connector line drawn from
 * `(sx, sy)`. The line stops 4pt outside the BP stroke so the dashed
 * marks don't crash into the ring.
 */
export function connectorEndpoint(sx: number, sy: number): { x: number; y: number } {
  const dx = BP_CX - sx;
  const dy = BP_CY - sy;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: BP_CX, y: BP_CY };
  const r = BP_DIAMETER / 2 + 4;
  const ux = dx / len;
  const uy = dy / len;
  return { x: BP_CX - ux * r, y: BP_CY - uy * r };
}

// ---------------------------------------------------------------------------
// Subviews
// ---------------------------------------------------------------------------

interface RingWrapperProps {
  /** Stagger index — 0 for BP centre, 1..4 for satellites. */
  index: number;
  reduceMotion: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

function RingWrapper({ index, reduceMotion, children, style }: RingWrapperProps) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = dailyPulseRevealOpacity(false, index);
  }, [index, reduceMotion, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

interface NarrationProps {
  text: string;
  reduceMotion: boolean;
}

function NarrationLine({ text, reduceMotion }: NarrationProps) {
  const theme = useTheme();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = dailyPulseRevealNarrationOpacity(false);
  }, [reduceMotion, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const displayMStyle = theme.type('displayM');
  return (
    <Animated.Text
      style={[
        animated,
        {
          fontFamily: displayMStyle.family,
          fontSize: displayMStyle.size,
          lineHeight: displayMStyle.lineHeight,
          fontStyle: 'italic',
          fontWeight: '600',
          color: theme.colors.brand.coral,
          textAlign: 'center',
          marginTop: 12,
          paddingHorizontal: 24,
        },
      ]}
    >
      {text}
    </Animated.Text>
  );
}

// ---------------------------------------------------------------------------
// The verdict line — Sprint 19 (audit P1-5).
//
// The hero carried `label`, `value`, `sub` and `live` but no status, so
// the single biggest number in the app arrived with no interpretation:
// home showed "128/82 · mmHg · 6:42 am" while BPDetail, two taps away,
// showed "mmHg · within your usual range" for the same reading.
//
// The copy is NOT written here. `vitalRangeCopyForTier` is the one place
// tier vocabulary lives (see its doc-block: "Everything that surfaces a
// tier imports from here. Do not re-coin.").
// ---------------------------------------------------------------------------

function centralVerdict(central: DailyPulseHeroCentral): string | undefined {
  if (!central.unit) return undefined;
  if (central.canonicalTier === 'learning') {
    // §7.4 learning fragment, self subject, sub-line form.
    return `${central.unit} · still learning what's usual for you`;
  }
  return vitalRangeCopyForTier(central.unit, central.tier);
}

// ---------------------------------------------------------------------------
// Composed accessibility label — read by screen-reader users. Mirrors
// what visual users see: central value first, then each satellite, then
// the AI narration.
// ---------------------------------------------------------------------------

function composeAccessibilityLabel(
  central: DailyPulseHeroCentral,
  vitals: DailyPulseHeroVitals,
  aiNarration: string | undefined,
  parentName: string | undefined,
): string {
  const subject = parentName ? `Daily pulse for ${parentName}` : 'Daily pulse';
  const parts: string[] = [subject, `${central.label} ${central.value}`];
  // Sprint 19 (audit P1-5) — a screen-reader user got the number with no
  // verdict either. Reads immediately after the value, as it renders.
  const verdict = centralVerdict(central);
  if (verdict) parts.push(verdict);
  for (const def of SATELLITES) {
    const v = vitals[def.vital];
    parts.push(`${VITAL_HUMAN_NAME[def.vital]} ${v.display} ${v.unit}`);
  }
  if (aiNarration) parts.push(aiNarration);
  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DailyPulseHero({
  vitals,
  central,
  aiNarration,
  parentName,
  onSelectVital,
  testID,
  style,
}: DailyPulseHeroProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const labelStyle = theme.type('labelUppercase');
  const numericHero = theme.type('numericHero');
  const numericXl = theme.type('numericXl');
  const numericM = theme.type('numericM');
  const captionStyle = theme.type('caption');
  const bpColor = theme.colors.vital.bp;

  // Ambient breathing glow under the BP ring. Reduced motion → static.
  //
  // Sprint 19 (audit D12 P0-5): this animated style is applied after
  // `styles.glow`, so these values — not the stylesheet's — are what
  // renders. See GLOW_OPACITY_REST/PEAK in VitalHero for the rationale
  // and the contrast ceiling.
  const glowOpacity = useSharedValue<number>(GLOW_OPACITY_REST);
  useEffect(() => {
    if (reduceMotion) {
      glowOpacity.value = GLOW_OPACITY_STATIC;
      return;
    }
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(GLOW_OPACITY_PEAK, {
          duration: GLOW_BREATHE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(GLOW_OPACITY_REST, {
          duration: GLOW_BREATHE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
  }, [reduceMotion, glowOpacity]);
  const glowAnimated = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));

  const composedA11yLabel = composeAccessibilityLabel(
    central,
    vitals,
    aiNarration,
    parentName,
  );
  // Sprint 19 (audit P1-5).
  const verdict = centralVerdict(central);

  const bpRing = vitals.bp;
  const bpRingState: VitalRingState = reduceMotion
    ? 'idle'
    : bpRing.state ?? (bpRing.live ? 'pulsing' : 'filling');

  // Pre-compute satellite positions + connector endpoints once.
  const satellites = SATELLITES.map((def) => ({
    def,
    pos: satellitePosition(def),
    state: vitals[def.vital],
  }));

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View accessible={true}
        accessibilityRole="text"
        accessibilityLabel={composedA11yLabel}
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        {/* Ambient glow under the central ring — soft tinted blob. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            { backgroundColor: bpColor, left: BP_CX - 130, top: BP_CY - 130 },
            glowAnimated,
          ]}
        />

        {/* Decorative dashed connector lines: each satellite → BP edge. */}
        <Svg
          width={CANVAS_W}
          height={CANVAS_H}
          style={styles.svgOverlay}
          pointerEvents="none"
        >
          {satellites.map(({ pos }, i) => {
            const end = connectorEndpoint(pos.cx, pos.cy);
            return (
              <Line
                key={i}
                x1={pos.cx}
                y1={pos.cy}
                x2={end.x}
                y2={end.y}
                stroke={theme.colors.text.primary}
                strokeOpacity={0.08}
                strokeWidth={0.5}
                strokeDasharray="2 3"
              />
            );
          })}
        </Svg>

        {/* Central BP ring. Tappable when onSelectVital is supplied. */}
        <RingWrapper
          index={0}
          reduceMotion={reduceMotion}
          style={{
            position: 'absolute',
            left: BP_CX - BP_DIAMETER / 2,
            top: BP_CY - BP_DIAMETER / 2,
            width: BP_DIAMETER,
            height: BP_DIAMETER,
          }}
        >
          <Pressable
            onPress={onSelectVital ? () => onSelectVital('bp') : undefined}
            accessibilityRole={onSelectVital ? 'button' : 'text'}
            // Sprint 19 (audit P1-5) — the ring is the focusable node for
            // the hero value, so the verdict belongs here too.
            accessibilityLabel={
              verdict
                ? `${central.label} ${central.value}, ${verdict}`
                : `${central.label} ${central.value}`
            }
            testID={testID ? `${testID}-bp` : undefined}
            style={styles.bpPressable}
          >
            <VitalRing
              vitalType="bp"
              fill={bpRing.fill}
              colorOverride={
                central.canonicalTier === 'learning'
                  ? theme.colors.status.learning
                  : undefined
              }
              diameter={BP_DIAMETER}
              strokeWidth={BP_STROKE}
              state={bpRingState}
              fillDelayMs={
                bpRingState === 'filling' ? OPACITY_REVEAL_MS : 0
              }
            />
            <View pointerEvents="none" style={styles.bpCentre}>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                style={{
                  fontFamily: labelStyle.family,
                  fontSize: labelStyle.size,
                  lineHeight: labelStyle.lineHeight,
                  letterSpacing: labelStyle.letterSpacing,
                  color: bpColor,
                  textTransform: 'uppercase',
                  marginBottom: 2,
                }}
              >
                {central.label}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  // Sprint 19 (audit P1-2) — was `fontFamilies.editorial`
                  // (Instrument Serif, a proportional display serif)
                  // while pulling its size from the numeric tokens, which
                  // are specified in JetBrains Mono. Tabular figures stop
                  // the 80pt value jittering as digits change.
                  fontFamily: theme.fontFamilies.numeric,
                  fontVariant: ['tabular-nums'],
                  // Adaptive sizing — numericHero (80pt) is sized for
                  // short values like "63" or "124/79". Mixed-unit
                  // strings ("10h 44m") overflow the ring inner; drop
                  // to numericXl (56pt) for anything > 5 chars so the
                  // value stays centred + readable.
                  fontSize: central.value.length > 5 ? numericXl.size : numericHero.size,
                  lineHeight: central.value.length > 5 ? numericXl.lineHeight : numericHero.lineHeight,
                  color: theme.colors.text.primary,
                  letterSpacing: -0.5,
                  textAlign: 'center',
                  maxWidth: BP_DIAMETER - 24,
                }}
                testID={testID ? `${testID}-bp-value` : undefined}
              >
                {central.value}
              </Text>
              {central.sub ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: captionStyle.size,
                    lineHeight: captionStyle.lineHeight,
                    color: theme.colors.text.tertiary,
                    letterSpacing: 0.4,
                    marginTop: 6,
                    textTransform: 'uppercase',
                  }}
                >
                  {central.sub}
                </Text>
              ) : null}
              {central.live ? (
                <View
                  style={[styles.livePill, { backgroundColor: bpColor + '26' }]}
                  testID={testID ? `${testID}-bp-live` : undefined}
                >
                  <View
                    style={[styles.liveDot, { backgroundColor: bpColor }]}
                  />
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                    style={{
                      fontFamily: theme.fontFamilies.numeric,
                      fontSize: 11,
                      letterSpacing: 1.4,
                      color: bpColor,
                      textTransform: 'uppercase',
                    }}
                  >
                    Live
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        </RingWrapper>

        {/* Satellite rings — HR / SpO2 / Sleep / Activity in a curved arc. */}
        {satellites.map(({ def, pos, state }, i) => {
          const vitalColor = theme.colors.vital[def.vital];
          const ringRenderState: VitalRingState = reduceMotion
            ? 'idle'
            : state.state ?? (state.live ? 'pulsing' : 'filling');
          return (
            <RingWrapper
              key={def.vital}
              index={i + 1}
              reduceMotion={reduceMotion}
              style={{
                position: 'absolute',
                left: pos.left,
                top: pos.top,
                width: def.size,
                height: def.size,
              }}
            >
              <Pressable
                onPress={onSelectVital ? () => onSelectVital(def.vital) : undefined}
                accessibilityRole={onSelectVital ? 'button' : 'text'}
                accessibilityLabel={`${VITAL_HUMAN_NAME[def.vital]} ${state.display} ${state.unit}`}
                testID={testID ? `${testID}-${def.vital}` : undefined}
                style={styles.satellitePressable}
              >
                <VitalRing
                  vitalType={def.vital}
                  fill={state.fill}
                  diameter={def.size}
                  strokeWidth={def.stroke}
                  state={ringRenderState}
                  fillDelayMs={
                    ringRenderState === 'filling'
                      ? OPACITY_REVEAL_MS + (i + 1) * STAGGER_MS
                      : 0
                  }
                />
                <View pointerEvents="none" style={styles.satCentre}>
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                    style={{
                      // Sprint 19 (audit P1-2) — same serif/numeric-token
                      // mismatch as the central value above. Tabular
                      // figures keep the satellite values from shifting
                      // inside their rings as digits change.
                      fontFamily: theme.fontFamilies.numeric,
                      fontVariant: ['tabular-nums'],
                      fontSize: def.size > 70 ? numericM.size : numericM.size - 4,
                      lineHeight: def.size > 70 ? numericM.lineHeight : numericM.lineHeight - 4,
                      color: theme.colors.text.primary,
                      letterSpacing: -0.3,
                    }}
                    numberOfLines={1}
                  >
                    {state.display}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                    style={{
                      fontFamily: theme.fontFamilies.numeric,
                      fontSize: 11,
                      letterSpacing: 0.5,
                      color: vitalColor,
                      textTransform: 'uppercase',
                      marginTop: 2,
                    }}
                  >
                    {state.unit}
                  </Text>
                </View>
              </Pressable>
            </RingWrapper>
          );
        })}

        {/* Sprint 19 (audit P1-5) — the verdict for the central value.
            Sits just under the BP ring so it reads as that number's
            caption, in the canvas dead space the satellites never use. */}
        {verdict ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            numberOfLines={1}
            adjustsFontSizeToFit
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: VERDICT_TOP,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontFamily: theme.fontFamilies.numeric,
              fontSize: captionStyle.size,
              lineHeight: captionStyle.lineHeight,
              letterSpacing: 0.4,
              color: theme.colors.text.secondary,
            }}
            testID={testID ? `${testID}-bp-verdict` : undefined}
          >
            {verdict}
          </Text>
        ) : null}
      </View>

      {aiNarration ? (
        <NarrationLine text={aiNarration} reduceMotion={reduceMotion} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  glow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    // Overridden at runtime by the animated glow style (see GLOW_OPACITY_*).
    // Kept in sync so a static render matches the animated rest state.
    opacity: opacity.glowRest,
  },
  svgOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  bpPressable: {
    width: BP_DIAMETER,
    height: BP_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bpCentre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  satellitePressable: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  satCentre: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 8,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
