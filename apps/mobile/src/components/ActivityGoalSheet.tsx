// ActivityGoalSheet — Sprint 8.5 (vital-detail · activity).
//
// Bottom-sheet picker for the daily step goal. Five segmented options
// (4,000 / 6,000 / 8,000 / 10,000 / 12,000) — the 6,000 default is per
// Q-D13-1 (lower than the typical 10,000, appropriate for hypertensive
// adults including elders). The sheet also carries a calm helper line
// reinforcing that the starting goal is comfortable.
//
// API:
//   - `open` mirrors `BottomSheet.visible`.
//   - `currentGoal` preloads the selection.
//   - `onSubmit(newGoal)` fires on Save tap; the call site calls
//     `onClose()` after persistence (Sprint 10 wires the real
//     persistence). The sheet itself doesn't auto-dismiss — leaving the
//     close behaviour to the caller keeps it composable with future
//     async save flows.
//
// Voice rules (docs/05-voice-and-claims.md):
//   - "Daily step goal" — neutral, factual.
//   - Helper sentence: "We start at 6,000 — comfortable for most people.
//     Adjust whenever you'd like." — no oversimplifying adjectives, no urgency.
//   - Save button: "Save".
//   - No gamification verbs (any "[Cr]ush"-style, "[Be]ast mode",
//     "[Ki]ller", "Streak"-as-celebration) anywhere in the rendered tree.
//
// Tests cover: rendering of the five segmented options + helper copy +
// save-tap flow, plus a voice-grep that ensures none of the forbidden
// gamification words slip into the rendered text.

import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

const GOAL_OPTIONS = [4000, 6000, 8000, 10000, 12000] as const;

const HELPER_COPY =
  "We start at 6,000 — comfortable for most people. Adjust whenever you'd like.";

export interface ActivityGoalSheetProps {
  open: boolean;
  currentGoal: number;
  onSubmit: (newGoal: number) => void;
  onClose: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function ActivityGoalSheet({
  open,
  currentGoal,
  onSubmit,
  onClose,
  testID,
}: ActivityGoalSheetProps) {
  const theme = useTheme();
  const labelStyle = theme.type('label');
  const captionStyle = theme.type('caption');

  // Preload the current goal; reset to current when re-opened so a
  // canceled sheet doesn't carry over a stale selection.
  const [selected, setSelected] = useState<number>(currentGoal);
  useEffect(() => {
    if (open) setSelected(currentGoal);
  }, [open, currentGoal]);

  const handleSave = () => {
    onSubmit(selected);
    onClose();
  };

  return (
    <BottomSheet
      visible={open}
      onDismiss={onClose}
      size="compact"
      title="Daily step goal"
      testID={testID}
    >
      <View style={styles.body}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: captionStyle.family,
            fontSize: captionStyle.size,
            lineHeight: captionStyle.lineHeight,
            color: theme.colors.text.secondary,
            marginBottom: theme.spacing.l,
          }}
          testID={testID ? `${testID}-helper` : undefined}
        >
          {HELPER_COPY}
        </Text>
        <View style={styles.optionRow}>
          {GOAL_OPTIONS.map((value) => {
            const isSelected = value === selected;
            const a11yLabel = `${value.toLocaleString()} steps`;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={a11yLabel}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelected(value)}
                hitSlop={6}
                testID={testID ? `${testID}-option-${value}` : undefined}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: isSelected
                      ? theme.colors.vital.activity + '26'
                      : theme.colors.surface.warmSubtle,
                    borderColor: isSelected
                      ? theme.colors.vital.activity
                      : theme.colors.border.rim,
                    borderRadius: theme.radii.m,
                    opacity: pressed && !isSelected ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: labelStyle.size,
                    lineHeight: labelStyle.lineHeight,
                    color: isSelected
                      ? theme.colors.text.primary
                      : theme.colors.text.secondary,
                    letterSpacing: 0.4,
                  }}
                >
                  {value.toLocaleString()}
                </Text>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: 9,
                    color: theme.colors.text.tertiary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    marginTop: 2,
                  }}
                >
                  steps
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: theme.spacing.l }}>
          <Button
            variant="primary"
            onPress={handleSave}
            testID={testID ? `${testID}-save` : undefined}
          >
            Save
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingTop: 8,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  option: {
    flexBasis: '18%',
    flexGrow: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
});
