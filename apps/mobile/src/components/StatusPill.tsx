// StatusPill — Sprint 7.7a (caregiver Family Constellation).
//
// A specialised pill for the six per-person status states that drive the
// caregiver home: clear / watch / attention / urgent / offline / sleeping.
// Distinct from the existing Pill (filter chip / general status) — this
// one carries a leading dot with status-coloured glow and an uppercase
// mono label.
//
// Status taxonomy maps to backend signals as:
//   clear     ← classification.tier === 'in_pattern'
//   watch     ← 3-day BP trend up but not yet calm-concerned (Sprint 15
//              anomaly engine — until then, treated same as clear by the
//              hook layer; the type space is preserved here)
//   attention ← classification.tier === 'calm_concerned'
//   urgent    ← classification.tier === 'confirmed_urgent'
//   offline   ← staleness > offline threshold per D13 §6
//   sleeping  ← active sleep session within the last 4h
//
// Voice rules (docs/05-voice-and-claims.md): the labels are calm + plain
// + no fear language. "Needs attention" is the strongest non-emergency
// label (no "critical", no "dangerous"). "Urgent" is reserved for the
// confirmed-urgent classification per the spec.

import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export type Status =
  | 'clear'
  | 'watch'
  | 'attention'
  | 'urgent'
  | 'offline'
  | 'sleeping'
  // D13 PR-4 (§4.3) — data still accumulating; below the sufficiency
  // gate a person renders grey, never a coloured verdict.
  | 'learning';

export interface StatusPillProps {
  status: Status;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// D13 PR-2 (§6.1, §7.4) — "All clear" is deleted: "all clear" is
// itself a claim. The clear state is a statement about the person's
// own range; "their" is the always-safe possessive on multi-person
// surfaces (the pill never renders on self surfaces).
const STATUS_LABEL: Record<Status, string> = {
  clear: 'In their usual range',
  learning: 'Learning',
  watch: 'Watch',
  attention: 'Needs attention',
  urgent: 'Urgent',
  offline: 'No recent reading',
  sleeping: 'Sleeping',
};

// '24' = 14% alpha for the tinted background. '59' = 35% for the border.
// Matches the design's `tone.replace(')', ' / .14)')` and `.35)` patterns.
const BG_ALPHA = '24';
const BORDER_ALPHA = '59';

export function StatusPill({ status, testID, style }: StatusPillProps) {
  const theme = useTheme();
  const tone = theme.colors.status[status];
  const labelStyle = theme.type('labelUppercase');

  // Sleeping has no dot glow — the periwinkle reads as a calm marker, not
  // a live signal. Every other status emits a soft glow that matches the
  // dot colour.
  const glowShadow =
    status === 'sleeping'
      ? null
      : {
          shadowColor: tone,
          shadowOpacity: 0.6,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={STATUS_LABEL[status]}
      testID={testID}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingVertical: 4,
          paddingLeft: 7,
          paddingRight: 8,
          borderRadius: 99,
          backgroundColor: tone + BG_ALPHA,
          borderWidth: 0.5,
          borderColor: tone + BORDER_ALPHA,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <View
        style={[
          {
            width: 5,
            height: 5,
            borderRadius: 99,
            backgroundColor: tone,
          },
          glowShadow,
        ]}
      />
      <Text
        style={{
          // D13 PR-2 — sentence case, never uppercase (docs/05:182).
          fontFamily: theme.fontFamilies.bodyMedium,
          fontSize: 11,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: 0.2,
          color: tone,
        }}
        maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
      >
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

export const STATUS_LABEL_FOR = STATUS_LABEL;
