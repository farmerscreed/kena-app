// ViewAsTableLink — D13 PR-6 (§6.3, §9.1). Mounted on EVERY screen that
// renders a chart. A chart's composed label summarises; this link is
// the full non-visual route to the underlying numbers — before it,
// HRDetail and Trends had no screen-reader path to their data at all.
//
// Renders as a quiet inline toggle that expands an accessible table:
// one row per point, each row one accessibility element, values in the
// numeric face. No modal, no navigation — the numbers appear in place,
// after the chart they describe.

import { useState } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT, MAX_FONT_SCALE } from '../theme/fontScaling';

export interface TableRow {
  /** Row label — a time or date ("6:42 am", "Mon 12 Aug"). */
  label: string;
  /** Pre-formatted value ("128/82", "64 bpm", "97%"). */
  value: string;
}

export interface ViewAsTableLinkProps {
  rows: TableRow[];
  /** What the table holds, for the toggle's a11y hint ("readings"). */
  subjectNoun?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function ViewAsTableLink({
  rows,
  subjectNoun = 'readings',
  testID,
  style,
}: ViewAsTableLinkProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const label = theme.type('label');
  const numericM = theme.type('numericM');
  const bodyM = theme.type('bodyM');

  if (rows.length === 0) return null;

  return (
    <View style={style} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide table' : 'View as table'}
        accessibilityHint={`Shows the ${subjectNoun} behind the chart as text`}
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: label.family,
            fontSize: label.size,
            lineHeight: label.lineHeight,
            color: theme.colors.text.secondary,
            textDecorationLine: 'underline',
          }}
        >
          {open ? 'Hide table' : 'View as table'}
        </Text>
      </Pressable>
      {open
        ? rows.map((row, i) => (
            <View
              key={`${row.label}-${i}`}
              accessible={true}
              accessibilityRole="text"
              accessibilityLabel={`${row.label}, ${row.value}`}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 6,
                borderBottomWidth: i === rows.length - 1 ? 0 : 0.5,
                borderBottomColor: theme.colors.surface.warmElevated,
              }}
              testID={testID ? `${testID}-row-${i}` : undefined}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                style={{
                  fontFamily: bodyM.family,
                  fontSize: bodyM.size,
                  lineHeight: bodyM.lineHeight,
                  color: theme.colors.text.secondary,
                }}
              >
                {row.label}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                style={{
                  fontFamily: numericM.family,
                  fontVariant: ['tabular-nums'],
                  fontSize: numericM.size,
                  lineHeight: numericM.lineHeight,
                  color: theme.colors.text.primary,
                }}
              >
                {row.value}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}
