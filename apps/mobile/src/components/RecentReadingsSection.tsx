// RecentReadingsSection — Sprint 8.5 follow-up (on-device review 2026-05-08).
//
// Composes the section eyebrow + RecentReadingsList + a "Show more"
// footer that opens a count-picker bottom sheet (5 / 20 / 50 / 100 / All).
//
// Background: the original Sprint 8.5 detail screens hard-sliced their
// readings to the most-recent 4. The on-device review found that
// 17 BP readings were on the server but only 4 were visible — no path
// to the rest. This wrapper turns each detail screen's "recent" block
// into a paged list with an explicit count selector.
//
// API design:
//   - Presentational. Consumer hands in the FULL `readings` array
//     (already sorted newest-first). The wrapper handles slicing +
//     state for the visible count.
//   - `defaultCount` lets the caller pick a sensible starting density
//     per vital (BP defaults to 5; Sleep / Activity might prefer 7).
//   - Footer button is hidden when the full list is shorter than the
//     default — no "Show more" affordance for a 2-row history.
//
// Voice rules: visible strings here ("Showing X of Y · tap to change",
// "Show more readings", "Daily readings to show", "All readings") are
// calm + factual. No "patient" / "diagnose" / "predict".

import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BottomSheet } from './BottomSheet';
import {
  RecentReadingsList,
  type RecentReading,
} from './RecentReadingsList';
import { useTheme } from '../theme';
import type { VitalType } from './VitalRing';
import { MAX_FONT_SCALE } from '../theme/fontScaling';

/** "All" is treated as a sentinel that resolves to readings.length. */
type CountOption = number | 'all';

const DEFAULT_OPTIONS: readonly CountOption[] = [5, 20, 50, 100, 'all'] as const;

export interface RecentReadingsSectionProps {
  vital: VitalType;
  /** Eyebrow rendered above the list ("Today's readings", "Recent days"). */
  eyebrow: string;
  /** FULL readings array, sorted newest-first. The wrapper slices it. */
  readings: RecentReading[];
  /** Callback when a row is tapped. */
  onSelect?: (reading: RecentReading) => void;
  /** Initial count to render. Defaults to 5. */
  defaultCount?: number;
  /** Override the count options shown in the picker. Defaults to
   *  [5, 20, 50, 100, 'all']. */
  options?: readonly CountOption[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function resolveCount(option: CountOption, total: number): number {
  if (option === 'all') return total;
  return Math.min(option, total);
}

function labelFor(option: CountOption): string {
  return option === 'all' ? 'All' : String(option);
}

export function RecentReadingsSection({
  vital,
  eyebrow,
  readings,
  onSelect,
  defaultCount = 5,
  options = DEFAULT_OPTIONS,
  testID,
  style,
}: RecentReadingsSectionProps) {
  const theme = useTheme();
  const [visibleCount, setVisibleCount] = useState<number>(defaultCount);
  const [pickerOpen, setPickerOpen] = useState(false);

  const total = readings.length;
  // Clamp visibleCount to whatever's actually available so we don't
  // render an empty footer like "Showing 5 of 3".
  const effectiveCount = Math.min(visibleCount, total);

  const visibleReadings = useMemo(
    () => readings.slice(0, effectiveCount),
    [readings, effectiveCount],
  );

  const labelStyle = theme.type('labelUppercase');
  const captionStyle = theme.type('caption');
  const titleStyle = theme.type('title');

  // Footer is only meaningful when there's MORE to show than the
  // current default. With a list of 2 readings + defaultCount=5, the
  // user has nothing to expand to.
  const showFooter = total > defaultCount;
  const allShown = effectiveCount >= total;

  return (
    <View style={style} testID={testID}>
      {/* Eyebrow — matches the SectionLabel pattern from leiko-detail.jsx */}
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.text.tertiary,
          textTransform: 'uppercase',
          paddingHorizontal: theme.spacing.xl,
          marginBottom: theme.spacing.s,
        }}
        testID={testID ? `${testID}-eyebrow` : undefined}
      >
        {eyebrow}
      </Text>

      <RecentReadingsList
        vital={vital}
        readings={visibleReadings}
        onSelect={onSelect}
        testID={testID ? `${testID}-list` : undefined}
      />

      {showFooter ? (
        <Pressable
          onPress={() => setPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            allShown
              ? `Showing all ${total} readings · tap to change`
              : `Showing ${effectiveCount} of ${total} readings · tap to show more`
          }
          hitSlop={6}
          testID={testID ? `${testID}-footer` : undefined}
          style={({ pressed }) => ({
            marginTop: theme.spacing.m,
            marginHorizontal: theme.spacing.xl,
            paddingVertical: theme.spacing.m,
            paddingHorizontal: theme.spacing.l,
            borderRadius: theme.radii.m,
            backgroundColor: theme.colors.surface.warmSubtle,
            borderWidth: 0.5,
            borderColor: theme.colors.border.rim,
            opacity: pressed ? 0.7 : 1,
            alignItems: 'center',
          })}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              lineHeight: captionStyle.lineHeight,
              color: theme.colors.text.primary,
              fontWeight: '500',
            }}
          >
            {allShown
              ? `Showing all ${total} · change`
              : `Show more · ${effectiveCount} of ${total}`}
          </Text>
        </Pressable>
      ) : null}

      <BottomSheet
        visible={pickerOpen}
        onDismiss={() => setPickerOpen(false)}
        size="compact"
        title="Readings to show"
        testID={testID ? `${testID}-picker` : undefined}
      >
        <View style={styles.pickerBody}>
          <Text
            style={{
              fontFamily: captionStyle.family,
              fontSize: captionStyle.size,
              lineHeight: captionStyle.lineHeight,
              color: theme.colors.text.secondary,
              marginBottom: theme.spacing.l,
            }}
          >
            Pick how many recent readings to load.
          </Text>
          {options.map((opt) => {
            const resolved = resolveCount(opt, total);
            const selected = effectiveCount === resolved;
            const disabled = total === 0;
            return (
              <Pressable
                key={String(opt)}
                onPress={() => {
                  setVisibleCount(resolved);
                  setPickerOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Show ${labelFor(opt)} readings`}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                hitSlop={4}
                testID={testID ? `${testID}-option-${opt}` : undefined}
                style={({ pressed }) => ({
                  paddingVertical: theme.spacing.m,
                  paddingHorizontal: theme.spacing.l,
                  borderRadius: theme.radii.m,
                  backgroundColor: selected
                    ? theme.colors.surface.warmElevated
                    : 'transparent',
                  borderWidth: 0.5,
                  borderColor: selected
                    ? theme.colors.brand.coral
                    : theme.colors.border.rim,
                  marginBottom: theme.spacing.s,
                  opacity: pressed ? 0.7 : 1,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                })}
              >
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: titleStyle.family,
                    fontSize: titleStyle.size,
                    lineHeight: titleStyle.lineHeight,
                    color: selected
                      ? theme.colors.brand.coral
                      : theme.colors.text.primary,
                    fontWeight: '600',
                  }}
                >
                  {labelFor(opt)}
                </Text>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: captionStyle.size,
                    lineHeight: captionStyle.lineHeight,
                    color: theme.colors.text.tertiary,
                    letterSpacing: 0.4,
                  }}
                >
                  {opt === 'all' ? `${total} available` : `${resolved} max`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  pickerBody: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 16,
  },
});
