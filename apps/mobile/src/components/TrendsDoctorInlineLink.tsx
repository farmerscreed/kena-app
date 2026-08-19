// TrendsDoctorInlineLink — Trends v2 "The Letter".
//
// The soft, centred inline link at the bottom of Trends. Replaces the
// v1 "Share with your doctor" / "Save as PDF for my doctor" primary
// CTA. Per the brief, Trends does not surface a PDF affordance —
// only this one-line link that deep-links to "For your doctor" with
// the current range pre-selected.
//
// Mode-aware copy: self-buyer → "your doctor"; caregiver → "their
// doctor". Voice-rule clean.

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { DoctorLinkCard } from './DoctorLinkCard';
import type { AccountType } from '../types/database';

export function trendsDoctorInlineLinkCopy(accountType: AccountType): string {
  return accountType === 'caregiver'
    ? 'Want to put this together for their doctor?'
    : 'Want to put this together for your doctor?';
}

export interface TrendsDoctorInlineLinkProps {
  accountType: AccountType;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function TrendsDoctorInlineLink({
  onPress,
  style,
  testID,
}: TrendsDoctorInlineLinkProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.root,
        {
          paddingHorizontal: theme.spacing.l,
          paddingTop: theme.spacing.xl,
          paddingBottom: theme.spacing.m,
        },
        style,
      ]}
    >
      {/* Founder-test feedback (2026-08-19) — the underlined caption
          becomes the DoctorLinkCard so users actually find it. */}
      <DoctorLinkCard
        onPress={onPress}
        testID={testID}
        style={{ marginHorizontal: 0, marginTop: 0, alignSelf: 'stretch' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center' },
});
