// DoctorCoverPreview — Trends v2 follow-up: "For your doctor" screen.
//
// Low-fi typographic thumbnail of the doctor PDF's cover page. Reads
// as a typeset cover letter: brand mono eyebrow, italic subtitle,
// serif title ("For your doctor" / "For her doctor"), prepared-for
// line, a faint BP sparkline, and the 7-section table-of-contents.
//
// Render fidelity is intentionally low — the user is here to confirm
// the document looks like the kind of thing they'd bring to a
// 5-minute appointment, not to scrutinise the layout. The real PDF
// is generated server-side by `generate-doctor-pdf`.
//
// Plus paywall: when `freeUser` is true, a Plus-preview blur overlay
// covers the thumbnail. Real data preview only behind the lever.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme';
import type { AccountType } from '../types/database';

export interface DoctorCoverPreviewProps {
  /** Recipient's display name, e.g. "Adaeze Okeke". */
  preparedFor: string;
  /** Range label as it should print, e.g. "30 days". */
  rangeLabel: string;
  /** Inclusive date range, e.g. "Apr 12 – May 12, 2026". */
  datesLabel: string;
  /** Caregiver mode flips "your" → the parent's actual name in the
   *  cover line. */
  accountType: AccountType;
  /**
   * Sprint 16.5h — actual parent's name in caregiver mode (e.g.
   * "Patricia"). Used by the cover-letter body so it reads
   * "Patricia's mornings averaged 124/80" rather than "her mornings".
   * Self-buyer mode passes "you" / the user's name.
   */
  parentLabel?: string;
  /** Sparkline samples (BP systolic). Falls back to a flat line. */
  sparkline?: number[];
  /** True when the user can't yet generate — overlays the Plus pill. */
  freeUser?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SECTIONS = [
  'Cover & disclaimer',
  'Blood pressure',
  'Heart rate',
  'Oxygen saturation',
  'Sleep',
  'Activity',
  'Cross-vital observations',
];

// "Off-white linen" tones — fixed across themes. The PDF doesn't run
// through the runtime theme; the thumbnail mimics the cover page's
// typeset palette directly so it reads as paper, not chrome.
const PAPER = '#f3efe7';
const INK = '#1a1410';
const INK_SOFT = '#3d342b';
const HAIRLINE = '#c8b9a8';
const META = '#8b7c6e';
const ACCENT = '#c96442';

export function DoctorCoverPreview({
  preparedFor,
  rangeLabel,
  datesLabel,
  accountType,
  parentLabel,
  sparkline,
  freeUser = false,
  style,
  testID,
}: DoctorCoverPreviewProps) {
  const theme = useTheme();
  const isCaregiver = accountType === 'caregiver';
  // Sprint 16.5h — use the real parent's name when provided. Was
  // hardcoded "her" regardless of which parent (Dad / Mum / partner).
  const possessive = isCaregiver
    ? parentLabel?.trim()
      ? `${parentLabel.trim()}'s`
      : 'their'
    : 'your';

  const sparkPath = useMemo(
    () => buildSparklinePath(sparkline ?? [120, 122, 119, 124, 121, 126, 122, 120]),
    [sparkline],
  );

  return (
    <View accessible={true}
      style={[
        styles.root,
        {
          backgroundColor: PAPER,
          borderRadius: 4,
          padding: 20,
        },
        style,
      ]}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={`Preview of the PDF cover for ${possessive} doctor`}
    >
      {/* Letterhead row */}
      <View style={styles.letterheadRow}>
        <View style={{ flex: 1 }}>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 9,
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              color: ACCENT,
            }}
            testID={testID ? `${testID}-letterhead` : undefined}
          >
            Leiko
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.editorialItalic,
              fontSize: 10,
              color: INK_SOFT,
              marginTop: 4,
              fontStyle: 'italic',
            }}
          >
            A summary of recent readings
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 8,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: META,
            }}
            testID={testID ? `${testID}-dates` : undefined}
          >
            {datesLabel}
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 8,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: META,
              marginTop: 2,
            }}
            testID={testID ? `${testID}-range-label` : undefined}
          >
            {rangeLabel}
          </Text>
        </View>
      </View>

      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: HAIRLINE,
          marginVertical: 12,
        }}
      />

      {/* Title — "For [your|her] [italic doctor]." */}
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.editorial,
          fontSize: 22,
          lineHeight: 24,
          color: INK,
          letterSpacing: -0.3,
        }}
        testID={testID ? `${testID}-title-line-1` : undefined}
      >
        For {possessive}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.editorialItalic,
          fontSize: 28,
          lineHeight: 28,
          color: INK,
          letterSpacing: -0.5,
          fontStyle: 'italic',
        }}
        testID={testID ? `${testID}-title-line-2` : undefined}
      >
        doctor
      </Text>

      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 9,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          color: INK_SOFT,
          marginTop: 14,
        }}
        testID={testID ? `${testID}-prepared-for` : undefined}
      >
        Prepared for {preparedFor}
      </Text>

      {/* Faint sparkline */}
      <View style={{ marginTop: 14, opacity: freeUser ? 0.25 : 0.7 }}>
        <Svg width="100%" height={26} viewBox="0 0 100 18" preserveAspectRatio="none">
          <Path
            d={sparkPath.path}
            fill="none"
            stroke={ACCENT}
            strokeWidth={0.5}
            strokeLinecap="round"
          />
          {!freeUser
            ? sparkPath.points.map((p, i) => (
                <Circle key={i} cx={p.x} cy={p.y} r={0.5} fill={ACCENT} />
              ))
            : null}
        </Svg>
      </View>

      {/* Section list */}
      <View
        style={{ marginTop: 16 }}
        testID={testID ? `${testID}-sections` : undefined}
      >
        {SECTIONS.map((label, i) => (
          <View key={label} style={styles.sectionRow}>
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: 7.5,
                color: META,
                width: 16,
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </Text>
            <Text
              allowFontScaling={false}
              style={{
                flex: 1,
                fontFamily: theme.fontFamilies.editorial,
                fontSize: 10,
                color: INK_SOFT,
              }}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{
          height: StyleSheet.hairlineWidth,
          backgroundColor: HAIRLINE,
          marginTop: 14,
          marginBottom: 8,
        }}
      />
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.editorialItalic,
          fontSize: 8,
          color: META,
          fontStyle: 'italic',
          lineHeight: 12,
        }}
        testID={testID ? `${testID}-disclaimer` : undefined}
      >
        This report is general information. It is not a diagnosis. Please discuss with {possessive} doctor.
      </Text>

      {/* Free-tier blur + Plus pill */}
      {freeUser ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              backgroundColor: 'rgba(243, 239, 231, 0.78)',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingBottom: 36,
              borderRadius: 4,
            },
          ]}
          testID={testID ? `${testID}-plus-overlay` : undefined}
        >
          <View
            style={{
              backgroundColor: INK,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 99,
            }}
          >
            <Text
              allowFontScaling={false}
              style={{
                fontFamily: theme.fontFamilies.numeric,
                fontSize: 9,
                letterSpacing: 1.6,
                textTransform: 'uppercase',
                color: ACCENT,
              }}
            >
              Plus preview
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

import { useMemo } from 'react';

interface SparkPath {
  path: string;
  points: { x: number; y: number }[];
}

function buildSparklinePath(values: number[]): SparkPath {
  if (values.length === 0) return { path: '', points: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const xs = values.map((_, i) => (100 * i) / Math.max(1, values.length - 1));
  const ys = values.map((v) => 16 - ((v - min) / range) * 14);
  const points = xs.map((x, i) => ({ x, y: ys[i] }));
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`)
    .join(' ');
  return { path, points };
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    aspectRatio: 0.78,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  letterheadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 3,
  },
});
