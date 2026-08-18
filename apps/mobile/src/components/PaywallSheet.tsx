// PaywallSheet — Sprint 10a wires the real RevenueCat trial-start flow.
//
// Sourced from docs/09-paywall-and-iap.md §3 (paywall screen anatomy)
// and D8a §9.3-9.5 (account_type-switched headline + value bullets +
// price block).
//
// Sprint 10a additions on top of the Sprint 9 stub:
//   • Monthly / annual period toggle, with annual highlighted as the
//     recommended choice (per D8a §9.5 "annual is highlighted as
//     recommended").
//   • Live price strings sourced from the RevenueCat offerings query
//     (services/purchases). Falls back to the locked $4.99 / $39.99
//     copy from docs/09 §1 when the SDK isn't available (dev workspace
//     without RC keys, or first run before configure resolves).
//   • Primary CTA calls purchasePeriod() and resolves with a quiet
//     "we couldn't start the trial" message on user-cancel / store
//     error. The webhook is the authoritative entitlement path —
//     the sheet refetches the entitlement query on success so the
//     Plus surface unblocks immediately rather than waiting for
//     Realtime.
//   • Restore CTA for users who bought on another device.
//
// Voice: every string passes docs/05-voice-and-claims.md. No urgency,
// no countdown, no "limited time" framing. Cancellation language is
// dignified ("Maybe later", no penalty UX).

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { useTheme } from '../theme';
import { usePlusEntitlement } from '../hooks/usePlusEntitlement';
import {
  fetchOfferings,
  purchasePeriod,
  restorePurchases,
  type OfferingsSnapshot,
  type PurchasePeriod,
} from '../services/purchases';
import type { AccountType } from '../types/database';

export type PaywallTrigger =
  | 'range_extension'        // Trends — tap a >7d range chip
  | 'pdf_export'             // Trends — tap "Save as PDF for my doctor"
  | 'all_time_range'         // Trends — tap the All-time chip (self-buyer)
  | 'tier_b_query'           // AI assistant — first Tier-B query attempt
  | 'anomaly_optin'          // Home — tap proactive-alerts opt-in
  | 'sixth_reading'          // Auto-fire on 6th reading per identity
  | 'csv_export'             // Settings — tap "Export my data"
  | 'add_caregiver';         // Settings — tap "+ Add caregiver" past limit

export interface PaywallSheetProps {
  visible: boolean;
  onDismiss: () => void;
  /** Switches headline + value-bullet copy per D8a §9.3-9.4. */
  accountType: AccountType;
  /** Source of the trigger — feeds analytics + future routing. */
  trigger: PaywallTrigger;
  testID?: string;
}

interface PaywallCopy {
  headline: string;
  body: string;
  bullets: string[];
}

// Locked fallback strings from docs/09 §1. The store will report
// region-correct numbers; these are the canonical USD anchors that
// ship in marketing/legal copy.
const FALLBACK_PRICE_MONTHLY = '$4.99';
const FALLBACK_PRICE_ANNUAL = '$39.99';

function copyForMode(accountType: AccountType): PaywallCopy {
  if (accountType === 'self_buyer') {
    return {
      headline: 'Understand your numbers',
      body:
        'See trends clearly. Share them with your doctor. Get plain-language explanations of what your readings mean.',
      bullets: [
        'A one-page summary you can save and show your doctor',
        'Plain-language explanations of every reading and trend',
        'Full history, with no time limit on what you can see',
      ],
    };
  }
  return {
    headline: 'Stay close, every day',
    body:
      "Leiko helps you stay close to your parent's health — with calm, contextual updates.",
    bullets: [
      'Up to 5 family members can stay informed',
      'AI-generated weekly summaries',
      "Share readings with your parent's doctor",
    ],
  };
}

export function PaywallSheet({
  visible,
  onDismiss,
  accountType,
  trigger,
  testID,
}: PaywallSheetProps) {
  const theme = useTheme();
  const copy = copyForMode(accountType);
  const { refetch: refetchEntitlement, markPlusOptimistic } = usePlusEntitlement();

  const [period, setPeriod] = useState<PurchasePeriod>('annual');
  const [offerings, setOfferings] = useState<OfferingsSnapshot>({
    monthly: null,
    annual: null,
  });
  const [pending, setPending] = useState<'idle' | 'purchasing' | 'restoring'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Pull the live offerings once when the sheet opens. No-op when RC
  // isn't configured — the fallback copy carries the canonical price.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void fetchOfferings().then((snap) => {
      if (!cancelled) setOfferings(snap);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const monthlyPrice = offerings.monthly?.priceString ?? FALLBACK_PRICE_MONTHLY;
  const annualPrice = offerings.annual?.priceString ?? FALLBACK_PRICE_ANNUAL;

  const onPrimaryPress = useCallback(async () => {
    if (pending !== 'idle') return;
    setError(null);
    setPending('purchasing');
    try {
      const result = await purchasePeriod(period);
      // The webhook is the source of truth, but it may be a few seconds
      // out. If the local RC SDK already reports Plus active, flip the
      // entitlement cache optimistically so the gated surface unblocks
      // before the user's next tap — the realtime channel will
      // reconcile with the server value once the webhook lands.
      if (result.isPlusActive) markPlusOptimistic();
      await refetchEntitlement();
      onDismiss();
    } catch {
      setError("We couldn't start your trial. Tap to try again, or pick a different option.");
    } finally {
      setPending('idle');
    }
  }, [period, pending, markPlusOptimistic, refetchEntitlement, onDismiss]);

  const onRestorePress = useCallback(async () => {
    if (pending !== 'idle') return;
    setError(null);
    setPending('restoring');
    try {
      const result = await restorePurchases();
      if (result.isPlusActive) markPlusOptimistic();
      await refetchEntitlement();
      onDismiss();
    } catch {
      setError("We couldn't find a previous Leiko Plus on this account.");
    } finally {
      setPending('idle');
    }
  }, [pending, markPlusOptimistic, refetchEntitlement, onDismiss]);

  const headlineStyle = theme.type('headline');
  const bodyStyle = theme.type('bodyL');
  const bulletStyle = theme.type('bodyL');
  const labelStyle = theme.type('label');

  const periodChipBase = {
    flex: 1,
    paddingVertical: theme.spacing.m,
    borderRadius: theme.radii.m,
    borderWidth: 1,
    alignItems: 'center' as const,
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      size="full"
      surface="solid"
      title="Leiko Plus"
      testID={testID ?? `paywall-sheet:${trigger}`}
    >
      <View style={{ paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.xl }}>
        {/* Hero — headline + body */}
        <View style={{ marginTop: theme.spacing.l }}>
          <View accessible={true} accessibilityRole="header" accessibilityLabel={copy.headline}>
            <Text style={[headlineStyle, { color: theme.colors.text.primary }]}>
              {copy.headline}
            </Text>
          </View>
          <View style={{ marginTop: theme.spacing.s }}>
            <Text style={[bodyStyle, { color: theme.colors.text.secondary }]}>
              {copy.body}
            </Text>
          </View>
        </View>

        {/* Value bullets */}
        <View style={{ marginTop: theme.spacing.l }}>
          {copy.bullets.map((bullet) => (
            <View
              key={bullet}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                marginTop: theme.spacing.m,
              }}
            >
              <Text
                style={[
                  bulletStyle,
                  { color: theme.colors.brand.primary, width: theme.spacing.l },
                ]}
              >
                {'•'}
              </Text>
              <Text style={[bulletStyle, { color: theme.colors.text.primary, flex: 1 }]}>
                {bullet}
              </Text>
            </View>
          ))}
        </View>

        {/* Price block — monthly / annual toggle. Annual is highlighted
            as recommended per D8a §9.5. */}
        <View style={{ marginTop: theme.spacing.xl, flexDirection: 'row', gap: theme.spacing.m }}>
          <Pressable
            onPress={() => setPeriod('annual')}
            accessibilityRole="radio"
            accessibilityState={{ selected: period === 'annual' }}
            accessibilityLabel={`Annual plan, ${annualPrice} per year — saves 33%`}
            testID="paywall-sheet:period-annual"
            style={[
              periodChipBase,
              {
                backgroundColor:
                  period === 'annual' ? theme.colors.brand.primary : 'transparent',
                borderColor:
                  period === 'annual' ? theme.colors.brand.primary : theme.colors.border.subtle,
              },
            ]}
          >
            <Text
              style={[
                labelStyle,
                {
                  color:
                    period === 'annual'
                      ? theme.colors.text.onBrand
                      : theme.colors.text.tertiary,
                  fontWeight: period === 'annual' ? '600' : '400',
                },
              ]}
            >
              Best value · save 33%
            </Text>
            <Text
              style={[
                bodyStyle,
                {
                  color:
                    period === 'annual'
                      ? theme.colors.text.onBrand
                      : theme.colors.text.primary,
                  marginTop: theme.spacing.xs,
                  fontWeight: period === 'annual' ? '700' : '600',
                },
              ]}
            >
              {annualPrice} / year
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPeriod('monthly')}
            accessibilityRole="radio"
            accessibilityState={{ selected: period === 'monthly' }}
            accessibilityLabel={`Monthly plan, ${monthlyPrice} per month`}
            testID="paywall-sheet:period-monthly"
            style={[
              periodChipBase,
              {
                backgroundColor:
                  period === 'monthly' ? theme.colors.brand.primary : 'transparent',
                borderColor:
                  period === 'monthly' ? theme.colors.brand.primary : theme.colors.border.subtle,
              },
            ]}
          >
            <Text
              style={[
                labelStyle,
                {
                  color:
                    period === 'monthly'
                      ? theme.colors.text.onBrand
                      : theme.colors.text.tertiary,
                  fontWeight: period === 'monthly' ? '600' : '400',
                },
              ]}
            >
              Monthly
            </Text>
            <Text
              style={[
                bodyStyle,
                {
                  color:
                    period === 'monthly'
                      ? theme.colors.text.onBrand
                      : theme.colors.text.primary,
                  marginTop: theme.spacing.xs,
                  fontWeight: period === 'monthly' ? '700' : '600',
                },
              ]}
            >
              {monthlyPrice} / month
            </Text>
          </Pressable>
        </View>

        {/* Primary CTA — try free for 7 days */}
        <View style={{ marginTop: theme.spacing.xl }}>
          <Button
            variant="primary"
            onPress={onPrimaryPress}
            loading={pending === 'purchasing'}
            disabled={pending !== 'idle'}
            accessibilityLabel="Try Leiko Plus free for seven days"
            testID="paywall-sheet:cta-trial"
          >
            Try Leiko Plus free for 7 days
          </Button>

          {/* Quiet error surface — voice-passing, no scolding */}
          {error ? (
            <View style={{ marginTop: theme.spacing.m }}>
              <Text
                style={[labelStyle, { color: theme.colors.text.secondary, textAlign: 'center' }]}
                testID="paywall-sheet:error"
              >
                {error}
              </Text>
            </View>
          ) : null}

          {/* Restore + dismiss row */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: theme.spacing.m,
            }}
          >
            <Pressable
              onPress={onRestorePress}
              disabled={pending !== 'idle'}
              accessibilityLabel="Restore a previous Leiko Plus purchase"
              testID="paywall-sheet:cta-restore"
              hitSlop={8}
            >
              {pending === 'restoring' ? (
                <ActivityIndicator color={theme.colors.brand.primary} />
              ) : (
                <Text
                  style={[labelStyle, { color: theme.colors.brand.primarySoft }]}
                >
                  Restore purchase
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={onDismiss}
              disabled={pending !== 'idle'}
              accessibilityLabel="Maybe later"
              testID="paywall-sheet:cta-dismiss"
              hitSlop={8}
            >
              <Text
                style={[labelStyle, { color: theme.colors.brand.primarySoft }]}
              >
                Maybe later
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Legal footer — voice-passing, no urgency. Apple's auto-renew
            disclosure is a hard requirement at App Store submission. */}
        <View style={{ marginTop: theme.spacing.l, alignItems: 'center' }}>
          <Text style={[labelStyle, { color: theme.colors.text.tertiary, textAlign: 'center' }]}>
            Subscriptions auto-renew. Manage anytime in Settings.
          </Text>
        </View>
      </View>
    </BottomSheet>
  );
}
