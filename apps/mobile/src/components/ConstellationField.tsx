// ConstellationField — Sprint 7.7a (caregiver Family Constellation),
// rebuilt data-driven in Sprint 19 (audit P1-4).
//
// The bird's-eye field that anchors the caregiver home. Renders a canvas
// containing:
//   - A radial-gradient halo centred behind the field (coral 14% → 0%).
//   - Two dashed orbital rings at 6–8% opacity — soft, decorative, no
//     semantic load. Suppressed entirely when nobody is in orbit.
//   - One faint connection thread from the centre to each orb, drawn in
//     that person's accent at 18% opacity. The threads trace the
//     relational geometry — "you" at the centre, family in orbit.
//   - A small white centre dot (3pt) labelled "You" with a soft pulsing
//     ring around it (3s cycle, fades opacity 0.3 ↔ 0). Disabled under
//     reduced motion. Replaced by a full PersonOrb when the viewer wears
//     a watch (`selfNode`).
//   - One positioned `PersonOrb` per person, evenly distributed on a
//     polar ring.
//
// ── What Sprint 19 changed and why (audit P1-4) ──────────────────────
//
// v1 hardcoded a 360×360 canvas, three fixed orb slots and MAX_PEOPLE=3.
// `clampPeople` DROPPED everyone past index 2 behind a `__DEV__`
// console.warn, so a caregiver with five people in their circle saw
// three orbs — while the legend directly beneath listed all five. The
// primary visual silently misrepresented the size of the circle.
//
// At the other extreme, ONE person rendered a 72pt orb dead-centre in a
// 360×360 box: ~290pt of empty space with dashed rings orbiting nothing.
//
// The geometry is now derived from `people.length` by `constellationLayout`:
//   - Orb count, orb diameter and orbit radius all scale with the count.
//   - Positions are polar, evenly spaced — no fixed slots.
//   - The canvas WIDTH tracks `useWindowDimensions()` so the field fits a
//     320pt viewport (CaregiverHome insets a further 32pt), and the
//     HEIGHT is the bounding box of what actually renders, which
//     collapses the one-person dead space.
//   - Up to CONSTELLATION_MAX_ORBS people orbit. Past that the last slot
//     becomes a VISIBLE "+N more" node instead of a silent drop, and the
//     legend below stays authoritative for the full list.
//
// Why SVG for the field decoration but Views for the orbs:
//   - The rings, lines, and gradient are pure decoration — SVG is the
//     idiomatic primitive (matches VitalRing's pattern).
//   - The PersonOrb already composes Pressable + halo + Portrait + label,
//     and lives in the View tree so it can fire `onPress` + own its own
//     reanimated entrance. Stacking it absolutely over the SVG keeps both
//     concerns clean.
//
// Voice rules: the authored strings here are "You" and "+{n} more" /
// "{n} more in your circle" — calm, dignified, plain language, sentence
// case, no fear language. All person-facing text (names, BPs) flows in
// via the `people` prop.
//
// Reduced motion (D12 §7.4): the centre-dot pulse is the ONLY animation
// this component owns (PersonOrbs handle their own internally). Under
// reduced motion the pulse ring renders at its rest opacity (0).

import { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Line,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { PersonOrb } from './PersonOrb';
import { type Status } from './StatusPill';
import { useTheme } from '../theme';
import { useReducedMotion } from '../theme/useReducedMotion';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface ConstellationPerson {
  id: string;
  initial: string;
  fullName: string;
  /** Hex from `theme.colors.person.{1|2|3}`. */
  accent: string;
  status: Status;
  /** Pre-formatted BP string, e.g. "122/78". */
  bpLabel: string;
}

export interface ConstellationFieldProps {
  /**
   * Everyone orbiting the centre. The first `CONSTELLATION_MAX_ORBS` get
   * their own orb; beyond that the last ring position becomes a visible
   * "+N more" node (never a silent drop — see the doc-block above).
   */
  people: ConstellationPerson[];
  /** ADR-0006 Phase 3 — when the viewer is a wearer, their own circle is
   *  the CENTRE "You" anchor (showing their reading + name), not an
   *  orbiting node. Pass it here and exclude it from `people`. Caregivers
   *  (no self circle) leave this undefined → the bare "You" dot renders
   *  as before. */
  selfNode?: ConstellationPerson;
  onSelectPerson?: (id: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/**
 * How many ring positions the field draws. Past this the last position
 * carries the overflow marker, so the cap costs at most one visible
 * person and never hides the count.
 */
export const CONSTELLATION_MAX_ORBS = 5;

/** Design width. The field never grows past this on a large phone. */
const FIELD_MAX_W = 360;
/** Floor for very narrow viewports — below this the orbs stop fitting. */
const FIELD_MIN_W = 240;
/**
 * Horizontal space the host screen takes out of the window before this
 * component gets it — CaregiverHome's `paddingHorizontal: spacing.l` on
 * both sides.
 */
const FIELD_EDGE_GUTTER = 32;
/** Breathing room between the outermost artwork and the canvas edge. */
const FIELD_PAD = 8;

const CENTER_DOT_RADIUS = 3;
const CENTER_PULSE_DURATION_MS = 3000;
const CENTER_PULSE_PEAK_OPACITY = 0.3;
// ADR follow-up — the centre "You" orb (wearer's own node). Slightly
// larger than the biggest orbit slot so it reads as the anchor.
const SELF_ORB_DIAMETER = 72;

// PersonOrb hangs an absolutely-positioned name + BP label below the orb
// body, starting at `diameter + 4`. It is outside PersonOrb's laid-out
// box, so the field has to account for it when sizing the canvas or the
// bottom orbs' labels get clipped. 18pt name + 1pt gap + 13pt BP, times
// the tight Dynamic Type ceiling.
const ORB_LABEL_GAP = 4;
const ORB_LABEL_BLOCK_H = Math.ceil((18 + 1 + 13) * MAX_FONT_SCALE_TIGHT);

/** Bare "You" label under the centre dot (caregiver, no self node). */
const YOU_LABEL_TOP = 10;
const YOU_LABEL_H = Math.ceil(11 * MAX_FONT_SCALE_TIGHT);

/**
 * Where the first orb sits, in degrees CCW from horizontal. 150° is
 * upper-left, matching v1's leading slot, and the rest fan clockwise
 * from there so a 3-person circle still reads as the design's triangle.
 */
const START_ANGLE_DEG = 150;

/** Orbit radius by orb count — a lone orb sits closer in. */
const ORBIT_RADIUS_BY_COUNT = [0, 92, 112, 132, 136, 138];

/** Orb diameter by orb count — more people, smaller orbs. */
const ORB_DIAMETER_BY_COUNT = [0, 64, 64, 60, 54, 48];

// 18% as a 2-digit hex alpha — matches the design's `.replace(')', ' / .18)')`
// pattern. Used on the connection threads.
const THREAD_ALPHA = '2E';

// Opacity for the dashed orbital rings — design uses `.08` and `.06`.
const RING_OUTER_OPACITY = 0.08;
const RING_INNER_OPACITY = 0.06;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ---------------------------------------------------------------------------
// Geometry — pure, exported for unit tests
// ---------------------------------------------------------------------------

export interface ConstellationSlot {
  /** Orb centre x in canvas coordinates. */
  cx: number;
  /** Orb centre y in canvas coordinates. */
  cy: number;
  diameter: number;
}

export interface ConstellationLayout {
  width: number;
  height: number;
  /** Centre-anchor coordinates in canvas space. */
  cx: number;
  cy: number;
  slots: ConstellationSlot[];
  /** False when nothing orbits — no rings around an empty centre. */
  showRings: boolean;
  ringOuterR: number;
  ringInnerR: number;
  haloR: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function byCount<T>(table: readonly T[], count: number): T {
  return table[Math.min(count, table.length - 1)];
}

/**
 * Derives the whole field geometry from the number of ring nodes and the
 * width actually available.
 *
 * `nodeCount` counts ring POSITIONS, so an overflow marker counts as one.
 * `hasSelfNode` matters because the wearer's centre orb is much taller
 * than the bare "You" dot and drives the canvas height on its own when
 * the circle is small.
 */
export function constellationLayout(
  nodeCount: number,
  availableWidth: number,
  hasSelfNode: boolean,
): ConstellationLayout {
  const width = clamp(availableWidth, FIELD_MIN_W, FIELD_MAX_W);
  const cx = width / 2;

  if (nodeCount <= 0) {
    // Nobody orbits. Collapse to the centre anchor plus padding — no
    // rings, no halo ring geometry to speak of.
    const top = hasSelfNode ? -SELF_ORB_DIAMETER / 2 : -CENTER_DOT_RADIUS;
    const bottom = hasSelfNode
      ? SELF_ORB_DIAMETER / 2 + ORB_LABEL_GAP + ORB_LABEL_BLOCK_H
      : YOU_LABEL_TOP + YOU_LABEL_H;
    const height = bottom - top + FIELD_PAD * 2;
    return {
      width,
      height,
      cx,
      cy: -top + FIELD_PAD,
      slots: [],
      showRings: false,
      ringOuterR: 0,
      ringInnerR: 0,
      // Keep the glow inside the (now short) canvas so it fades out
      // rather than being cut off at the top and bottom edges.
      haloR: Math.min(width, height) / 2,
    };
  }

  const diameter = Math.round(
    byCount(ORB_DIAMETER_BY_COUNT, nodeCount) * (width / FIELD_MAX_W),
  );
  // Never let an orb (or its halo bleed) run off the canvas edge.
  const radius = Math.min(
    byCount(ORBIT_RADIUS_BY_COUNT, nodeCount) * (width / FIELD_MAX_W),
    width / 2 - diameter / 2 - FIELD_PAD,
  );

  // Evenly spaced, clockwise from the upper-left.
  const step = 360 / nodeCount;
  const raw = Array.from({ length: nodeCount }, (_, i) => {
    const rad = ((START_ANGLE_DEG - i * step) * Math.PI) / 180;
    return {
      dx: Math.cos(rad) * radius,
      // Screen y grows downward, so a positive sine is UP.
      dy: -Math.sin(rad) * radius,
      diameter,
    };
  });

  // Vertical bounding box of everything that renders, measured relative
  // to the centre anchor. This is what collapses the dead space.
  const tops = raw.map((p) => p.dy - p.diameter / 2);
  const bottoms = raw.map(
    (p) => p.dy + p.diameter / 2 + ORB_LABEL_GAP + ORB_LABEL_BLOCK_H,
  );
  tops.push(hasSelfNode ? -SELF_ORB_DIAMETER / 2 : -CENTER_DOT_RADIUS);
  bottoms.push(
    hasSelfNode
      ? SELF_ORB_DIAMETER / 2 + ORB_LABEL_GAP + ORB_LABEL_BLOCK_H
      : YOU_LABEL_TOP + YOU_LABEL_H,
  );
  // The dashed rings are part of the artwork; keep them inside too.
  const ringOuterR = radius + 10;
  const ringInnerR = Math.max(radius - 50, 20);
  tops.push(-ringOuterR);
  bottoms.push(ringOuterR);

  const minY = Math.min(...tops) - FIELD_PAD;
  const maxY = Math.max(...bottoms) + FIELD_PAD;

  return {
    width,
    height: maxY - minY,
    cx,
    cy: -minY,
    slots: raw.map((p) => ({ cx: cx + p.dx, cy: -minY + p.dy, diameter })),
    showRings: true,
    ringOuterR,
    ringInnerR,
    haloR: ringOuterR + 30,
  };
}

/**
 * Splits `people` into the ones that get their own orb and the number
 * hidden behind the overflow marker. Nothing is ever dropped silently:
 * `overflowCount > 0` means the field renders a "+N more" node.
 */
export function splitForOrbits(people: ConstellationPerson[]): {
  visible: ConstellationPerson[];
  overflowCount: number;
} {
  if (people.length <= CONSTELLATION_MAX_ORBS) {
    return { visible: people, overflowCount: 0 };
  }
  const visible = people.slice(0, CONSTELLATION_MAX_ORBS - 1);
  return { visible, overflowCount: people.length - visible.length };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConstellationField({
  people,
  selfNode,
  onSelectPerson,
  testID,
  style,
}: ConstellationFieldProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { width: windowWidth } = useWindowDimensions();

  // Sprint 19 (audit P1-4) — the field used to be a fixed 360pt box,
  // which overflows a 320pt viewport before CaregiverHome's own 32pt of
  // gutters are taken out.
  const { visible, overflowCount } = splitForOrbits(people);
  const nodeCount = visible.length + (overflowCount > 0 ? 1 : 0);
  const layout = constellationLayout(
    nodeCount,
    windowWidth - FIELD_EDGE_GUTTER,
    selfNode !== undefined,
  );

  // Centre dot pulse — opacity oscillates 0 → peak → 0 forever. Sequenced
  // so each cycle starts and ends at rest, which is also the reduced-
  // motion freeze state.
  const pulseOpacity = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      pulseOpacity.value = 0;
      return;
    }
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(CENTER_PULSE_PEAK_OPACITY, {
          duration: CENTER_PULSE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(0, {
          duration: CENTER_PULSE_DURATION_MS / 2,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
  }, [reduceMotion, pulseOpacity]);

  const pulseAnimatedProps = useAnimatedProps(() => ({
    opacity: pulseOpacity.value,
  }));

  // "YOU" uses the tertiary token, which now resolves to a warm bright
  // grey-cream #D9D2C2 (Sprint 16.6 palette tune). Recessive from the
  // surrounding primary serifs through tone + scale; never grey-dim
  // the way the previous tertiary #B8B5AE read on Android.
  const youLabelColor = theme.colors.text.tertiary;
  const centerDotColor = theme.colors.text.primary;

  const overflowSlot = overflowCount > 0 ? layout.slots[nodeCount - 1] : undefined;

  return (
    <View
      testID={testID}
      style={[styles.root, { width: layout.width, height: layout.height }, style]}
      accessibilityRole="summary"
    >
      <Svg
        width={layout.width}
        height={layout.height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        testID={testID ? `${testID}-svg` : undefined}
      >
        <Defs>
          <RadialGradient
            id="cg-fieldglow"
            cx="50%"
            cy="50%"
            r="50%"
            fx="50%"
            fy="50%"
          >
            <Stop
              offset="0%"
              stopColor={theme.colors.brand.coral}
              stopOpacity={0.14}
            />
            <Stop
              offset="100%"
              stopColor={theme.colors.brand.coral}
              stopOpacity={0}
            />
          </RadialGradient>
        </Defs>

        {/* Radial halo — coral glow, fades to transparent */}
        <Circle
          cx={layout.cx}
          cy={layout.cy}
          r={layout.haloR}
          fill="url(#cg-fieldglow)"
        />

        {/* Dashed orbital rings. Sprint 19 (audit P1-4): suppressed when
            nothing orbits — v1 drew them around an empty centre. */}
        {layout.showRings ? (
          <>
            <Circle
              cx={layout.cx}
              cy={layout.cy}
              r={layout.ringOuterR}
              fill="none"
              stroke={theme.colors.text.primary}
              strokeOpacity={RING_OUTER_OPACITY}
              strokeWidth={0.5}
              strokeDasharray="2 4"
            />
            <Circle
              cx={layout.cx}
              cy={layout.cy}
              r={layout.ringInnerR}
              fill="none"
              stroke={theme.colors.text.primary}
              strokeOpacity={RING_INNER_OPACITY}
              strokeWidth={0.5}
              strokeDasharray="2 4"
            />
          </>
        ) : null}

        {/* Faint connection threads from centre to each occupied orb */}
        {visible.map((person, i) => {
          const slot = layout.slots[i];
          if (!slot) return null;
          return (
            <Line
              key={`thread-${person.id}`}
              x1={layout.cx}
              y1={layout.cy}
              x2={slot.cx}
              y2={slot.cy}
              stroke={person.accent + THREAD_ALPHA}
              strokeWidth={0.5}
            />
          );
        })}
        {overflowSlot ? (
          <Line
            key="thread-overflow"
            x1={layout.cx}
            y1={layout.cy}
            x2={overflowSlot.cx}
            y2={overflowSlot.cy}
            stroke={theme.colors.text.primary + THREAD_ALPHA}
            strokeWidth={0.5}
          />
        ) : null}

        {/* Centre dot + pulsing ring — only for the pure-caregiver case
            (no selfNode). When the viewer wears a watch, a full beating
            PersonOrb is rendered at centre instead (below the SVG). */}
        {selfNode ? null : (
          <>
            <Circle
              cx={layout.cx}
              cy={layout.cy}
              r={CENTER_DOT_RADIUS}
              fill={centerDotColor}
            />
            <AnimatedCircle
              cx={layout.cx}
              cy={layout.cy}
              r={CENTER_DOT_RADIUS}
              fill="none"
              stroke={centerDotColor}
              strokeWidth={0.5}
              animatedProps={pulseAnimatedProps}
              testID={testID ? `${testID}-pulse` : undefined}
            />
          </>
        )}
      </Svg>

      {/* Centre "You" anchor. ADR-0006 Phase 3: when the viewer is a
          wearer (selfNode present), the centre shows THEIR name + reading
          and is tappable — they are the protagonist of their own
          constellation, not a redundant orbiting node. Caregivers (no
          selfNode) keep the quiet bare "You" label. */}
      {selfNode ? (
        // Wearer's own constellation: a full beating PersonOrb at centre
        // (same heartbeat halo as the orbiting people), with the "You"
        // label + reading beneath. The bare centre dot/ring is suppressed
        // above so this is the single centre element.
        <View
          style={{
            position: 'absolute',
            left: layout.cx,
            top: layout.cy - SELF_ORB_DIAMETER / 2,
            transform: [{ translateX: -SELF_ORB_DIAMETER / 2 }],
            width: SELF_ORB_DIAMETER,
            alignItems: 'center',
          }}
          testID={testID ? `${testID}-self` : undefined}
        >
          <PersonOrb
            initial={selfNode.initial}
            accent={selfNode.accent}
            status={selfNode.status}
            fullName={selfNode.fullName}
            bpLabel={selfNode.bpLabel}
            diameter={SELF_ORB_DIAMETER}
            onPress={
              onSelectPerson ? () => onSelectPerson(selfNode.id) : undefined
            }
            accessibilityLabel={`You — ${selfNode.fullName}, ${selfNode.bpLabel}`}
          />
          <Text
            allowFontScaling={false}
            pointerEvents="none"
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 11,
              lineHeight: 11,
              letterSpacing: 1.7,
              fontWeight: '500',
              color: youLabelColor,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            You
          </Text>
        </View>
      ) : (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: layout.cx,
            top: layout.cy + YOU_LABEL_TOP,
            transform: [{ translateX: -16 }],
          }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              // Design: 8.5pt mono uppercase, letter-spacing 0.20em
              // (~1.7pt at 8.5pt). The earlier 11pt bump made the
              // label compete with the orb portraits for attention;
              // small + quiet is the intent.
              fontSize: 11,
              lineHeight: 11,
              letterSpacing: 1.7,
              fontWeight: '500',
              color: youLabelColor,
              textTransform: 'uppercase',
            }}
          >
            You
          </Text>
        </View>
      )}

      {/* Person orbs — absolutely positioned over the SVG */}
      {visible.map((person, i) => {
        const slot = layout.slots[i];
        if (!slot) return null;
        // Position the orb's *centre* at the slot. PersonOrb roots from
        // its top-left, so we offset by half the diameter both ways.
        // The label that hangs below the orb is laid out absolutely
        // inside PersonOrb itself — it doesn't shift the anchor.
        return (
          <View
            key={person.id}
            style={{
              position: 'absolute',
              left: slot.cx - slot.diameter / 2,
              top: slot.cy - slot.diameter / 2,
            }}
            testID={testID ? `${testID}-orb-${person.id}` : undefined}
          >
            <PersonOrb
              initial={person.initial}
              accent={person.accent}
              status={person.status}
              fullName={person.fullName}
              bpLabel={person.bpLabel}
              diameter={slot.diameter}
              staggerIndex={i}
              onPress={
                onSelectPerson ? () => onSelectPerson(person.id) : undefined
              }
            />
          </View>
        );
      })}

      {/* Sprint 19 (audit P1-4) — the overflow marker. v1 dropped these
          people behind a console.warn while the legend beneath kept
          listing them. The count is now on screen, and the legend stays
          the authoritative full list. */}
      {overflowSlot ? (
        <View
          accessibilityRole="text"
          accessibilityLabel={`${overflowCount} more in your circle, listed below`}
          style={{
            position: 'absolute',
            left: overflowSlot.cx - overflowSlot.diameter / 2,
            top: overflowSlot.cy - overflowSlot.diameter / 2,
            width: overflowSlot.diameter,
            height: overflowSlot.diameter,
            borderRadius: overflowSlot.diameter / 2,
            borderWidth: 0.5,
            borderColor: theme.colors.border.rim,
            backgroundColor: theme.colors.surface.warmSubtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          testID={testID ? `${testID}-overflow` : undefined}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 13,
              lineHeight: 16,
              fontWeight: '500',
              color: theme.colors.text.secondary,
            }}
          >
            {`+${overflowCount}`}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 9.5,
              lineHeight: 12,
              letterSpacing: 0.8,
              color: theme.colors.text.tertiary,
              textTransform: 'uppercase',
            }}
          >
            more
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'center',
    position: 'relative',
  },
});
