// TrendsRangeChipsRow — Sprint 16.5g.
//
// Row of `7D / 30D / 90D / 1Y / All` Pill chips with explicit lock
// state for Plus-only ranges. Pre-fix, locked chips rendered with a
// trailing middle-dot ("30D ·") that read as a typo. Now we use a
// small "PLUS" superscript-style eyebrow on locked chips and apply
// the lock affordance via reduced opacity + an accessibility hint.
//
// Tapping a locked chip still fires `onRangeTap`; the screen wires it
// to the paywall sheet via the existing `PaywallTrigger` types.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pill } from '../../components/Pill';
import { useTheme } from '../../theme';
import type { TrendsRange } from '../../utils/trends-aggregate';
import type { AccountType } from '../../types/database';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';

const CAREGIVER_RANGES: TrendsRange[] = ['7d', '30d', '90d', '1y'];
const SELF_BUYER_RANGES: TrendsRange[] = ['7d', '30d', '90d', '1y', 'all_time'];
const FREE_RANGE: TrendsRange = '7d';
const RANGE_LABELS: Record<TrendsRange, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '1y': '1Y',
  all_time: 'All',
};

export interface TrendsRangeChipsRowProps {
  accountType: AccountType;
  active: TrendsRange;
  isPlus: boolean;
  onRangeTap: (r: TrendsRange) => void;
}

export function TrendsRangeChipsRow({
  accountType,
  active,
  isPlus,
  onRangeTap,
}: TrendsRangeChipsRowProps) {
  const theme = useTheme();
  const ranges =
    accountType === 'self_buyer' ? SELF_BUYER_RANGES : CAREGIVER_RANGES;
  return (
    <View
      style={{
        paddingTop: theme.spacing.m,
        paddingHorizontal: theme.spacing.l,
        flexDirection: 'row',
        gap: theme.spacing.xs,
        alignItems: 'center',
      }}
      testID="trends-range-row"
    >
      {ranges.map((r) => {
        const isActive = active === r;
        const locked = r !== FREE_RANGE && !isPlus;
        if (locked) {
          return (
            <LockedChip
              key={r}
              label={RANGE_LABELS[r]}
              isActive={isActive}
              onPress={() => onRangeTap(r)}
            />
          );
        }
        return (
          <Pill
            key={r}
            variant={isActive ? 'accent' : 'outline'}
            selected={isActive}
            onPress={() => onRangeTap(r)}
            testID={`trends-range:${r}`}
            accessibilityLabel={RANGE_LABELS[r]}
          >
            {RANGE_LABELS[r]}
          </Pill>
        );
      })}
    </View>
  );
}

// Sprint 16.5g — dedicated locked-chip affordance with a small "PLUS"
// pip. Visually de-emphasised, still tappable (opens the paywall).
function LockedChip({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const labelStyle = theme.type('labelUppercase');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} (Plus only)`}
      accessibilityHint="Opens the Plus paywall"
      testID={`trends-range:${label.toLowerCase()}-locked`}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: theme.colors.border.subtle,
          backgroundColor: isActive
            ? theme.colors.surface.warmElevated
            : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.numeric,
          fontSize: 13,
          color: theme.colors.text.tertiary,
          letterSpacing: -0.1,
        }}
      >
        {label}
      </Text>
      <View
        style={[
          styles.pip,
          {
            backgroundColor: theme.colors.brand.primary,
            marginLeft: 6,
          },
        ]}
        accessibilityElementsHidden
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: labelStyle.family,
            fontSize: 8,
            letterSpacing: 1.2,
            color: theme.colors.text.onBrand,
            textTransform: 'uppercase',
          }}
        >
          Plus
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
});
