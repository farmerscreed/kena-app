// ForYourDoctorRangeChipsRow — Sprint 16.5h.
//
// Lock-aware range chips for the For-your-doctor screen, mirroring
// the Trends `TrendsRangeChipsRow` we shipped in 16.5g. Pre-fix the
// chips used the plain Pill component for locked chips with no
// visual cue beyond accessibilityLabel.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pill } from '../../components/Pill';
import { useTheme } from '../../theme';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';
import {
  DOCTOR_PDF_RANGES,
  type DoctorPdfRange,
} from '../../services/doctorPdf';

const RANGE_LABEL: Record<DoctorPdfRange, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '1y': '1Y',
};

export interface ForYourDoctorRangeChipsRowProps {
  active: DoctorPdfRange;
  isPlus: boolean;
  onRangeTap: (r: DoctorPdfRange) => void;
}

export function ForYourDoctorRangeChipsRow({
  active,
  isPlus,
  onRangeTap,
}: ForYourDoctorRangeChipsRowProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: theme.spacing.xs,
        alignItems: 'center',
      }}
      testID="fyd-range-row"
    >
      {DOCTOR_PDF_RANGES.map((r) => {
        const isActive = active === r;
        const locked = r !== '7d' && !isPlus;
        if (locked) {
          return (
            <LockedChip
              key={r}
              label={RANGE_LABEL[r]}
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
            accessibilityLabel={RANGE_LABEL[r]}
            testID={`fyd-range:${r}`}
          >
            {RANGE_LABEL[r]}
          </Pill>
        );
      })}
    </View>
  );
}

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
      testID={`fyd-range:${label.toLowerCase()}-locked`}
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
