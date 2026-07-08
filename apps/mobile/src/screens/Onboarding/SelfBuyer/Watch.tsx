// Self-Buyer / Watch — docs/04-screens/self-buyer-onboarding.md §4.4.2
// (D8a §4.2). Two-card watch path. "I have it" calls
// completeSelfBuyer() — updates public.users (display_name + timezone +
// optional year_of_birth), runs the create_family RPC on the
// self_buyer branch, flips the navigator gate. "I need to order one"
// is gated off until the Shopify integration ships in a later sprint.

import { useState } from 'react';
import { Text, View } from 'react-native';
import { Card } from '../../../components/Card';
import { OnboardingEyebrow } from '../../../components/OnboardingEyebrow';
import { OnboardingScaffold } from '../../../components/OnboardingScaffold';
import { Pill } from '../../../components/Pill';
import { useTheme } from '../../../theme';
import { useOnboarding } from '../../../state/onboarding';
import { mmkv, STORAGE_KEYS } from '../../../services/storage';
import type { SelfBuyerOnboardingScreenProps } from '../../../navigation/types';

export function SelfBuyerWatchScreen({
  navigation,
}: SelfBuyerOnboardingScreenProps<'Watch'>) {
  const theme = useTheme();
  const completeSelfBuyer = useOnboarding((s) => s.completeSelfBuyer);
  const finalizing = useOnboarding((s) => s.finalizing);
  const finalizeError = useOnboarding((s) => s.finalizeError);

  const [pressed, setPressed] = useState<'have' | 'later' | null>(null);

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const title = theme.type('title');
  const caption = theme.type('caption');

  const handleHaveWatch = async () => {
    if (finalizing) return;
    setPressed('have');
    try {
      // ADR-0006 — "I have it" now actually leads to pairing. Pairing
      // lives on the home stack (not onboarding); completeSelfBuyer flips
      // the gate that swaps onboarding -> home. Set a one-shot flag so the
      // home navigator opens Pairing immediately on arrival.
      mmkv.set(STORAGE_KEYS.pairOnLaunch, true);
      await completeSelfBuyer();
    } catch {
      mmkv.remove(STORAGE_KEYS.pairOnLaunch);
      setPressed(null);
    }
  };

  // Sprint 19 Block 9 — "Add a watch later" parity with caregiver
  // FamilyWatch. Pre-Block-9 the only enabled card was "I have it",
  // which forced a self-buyer-without-a-watch (beta testers; people
  // ordering one separately) to misrepresent their state to get
  // through onboarding. completeSelfBuyer doesn't actually pair —
  // pairing lives in Settings → Devices regardless — so this card
  // shares the same handler with a more honest label.
  const handleAddLater = async () => {
    if (finalizing) return;
    setPressed('later');
    try {
      await completeSelfBuyer();
    } catch {
      setPressed(null);
    }
  };

  return (
    <OnboardingScaffold
      onBack={() => navigation.goBack()}
      keyboardAware={false}
      scrollTestID="self-buyer-watch-scroll"
    >
      <OnboardingEyebrow persona="Myself" step={2} total={2} />

      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={{
          color: theme.colors.text.primary,
          fontSize: headline.size,
          lineHeight: headline.lineHeight,
          fontWeight: headline.weight as '700',
          fontFamily: headline.family,
          marginBottom: theme.spacing.s,
        }}
      >
        Do you have the watch yet?
      </Text>

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: body.size,
          lineHeight: body.lineHeight,
          fontFamily: body.family,
          marginBottom: theme.spacing.xxl,
        }}
      >
        No problem either way — we'll guide you through the next step.
      </Text>

      <Card
        elevation="low"
        onPress={handleHaveWatch}
        disabled={finalizing}
        accessibilityLabel="I have it. Pair it now over Bluetooth."
        testID="self-buyer-watch-have"
        style={{ marginBottom: theme.spacing.l }}
      >
        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: title.size,
            lineHeight: title.lineHeight,
            fontWeight: title.weight as '600',
            fontFamily: title.family,
            marginBottom: theme.spacing.xs,
          }}
        >
          I have it
        </Text>
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: body.size,
            lineHeight: body.lineHeight,
            fontFamily: body.family,
          }}
        >
          Let's pair it now.
        </Text>
        {pressed === 'have' && finalizing ? (
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: caption.size,
              fontFamily: caption.family,
              marginTop: theme.spacing.s,
            }}
            accessibilityLiveRegion="polite"
          >
            Setting things up…
          </Text>
        ) : null}
      </Card>

      <Card
        elevation="default"
        disabled
        accessibilityLabel="I need to order one. Coming soon."
        testID="self-buyer-watch-order"
        style={{ marginBottom: theme.spacing.l }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: theme.spacing.xs,
          }}
        >
          <Text
            style={{
              color: theme.colors.text.primary,
              fontSize: title.size,
              lineHeight: title.lineHeight,
              fontWeight: title.weight as '600',
              fontFamily: title.family,
              flex: 1,
            }}
          >
            I need to order one
          </Text>
          <Pill variant="info">Coming soon</Pill>
        </View>
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: body.size,
            lineHeight: body.lineHeight,
            fontFamily: body.family,
          }}
        >
          We're getting the shop ready. We'll let you know when it opens.
        </Text>
      </Card>

      {/* Sprint 19 Block 9 — "Add a watch later" parity with the
          caregiver FamilyWatch screen. Same handler as "I have it"
          (completeSelfBuyer doesn't actually pair — pairing lives
          in Settings → Devices); the label is honest about the
          state. */}
      <Card
        elevation="low"
        onPress={handleAddLater}
        disabled={finalizing}
        accessibilityLabel="Add a watch later. Finish setup now and pair from Settings when you're ready."
        testID="self-buyer-watch-later"
        style={{ marginBottom: theme.spacing.l }}
      >
        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: title.size,
            lineHeight: title.lineHeight,
            fontWeight: title.weight as '600',
            fontFamily: title.family,
            marginBottom: theme.spacing.xs,
          }}
        >
          Add a watch later
        </Text>
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: body.size,
            lineHeight: body.lineHeight,
            fontFamily: body.family,
          }}
        >
          Finish setting up now. You can pair a watch from Settings whenever it's ready.
        </Text>
        {pressed === 'later' && finalizing ? (
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: caption.size,
              fontFamily: caption.family,
              marginTop: theme.spacing.s,
            }}
            accessibilityLiveRegion="polite"
          >
            Setting things up…
          </Text>
        ) : null}
      </Card>

      {finalizeError ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="self-buyer-watch-error"
          style={{
            color: theme.colors.state.urgent,
            fontSize: body.size,
            fontFamily: body.family,
            marginTop: theme.spacing.l,
          }}
        >
          {finalizeError}
        </Text>
      ) : null}
    </OnboardingScaffold>
  );
}
