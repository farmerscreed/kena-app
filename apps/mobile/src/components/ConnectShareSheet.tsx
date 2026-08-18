// ConnectShareSheet — Connect Phase B (2026-08-14).
//
// The ONE share surface for connecting two people, used identically from
// Home ("+ Connect") and Settings ("Connect with someone"). Replaces
// both CareInviteSheet and the Settings inline invite sheet, which were
// two hand-rolled implementations of the same flow with different copy.
//
// Zero required inputs: opening the sheet generates a code immediately
// (connect-create needs nothing since the accept-time email gate was
// dropped in Phase A). Each open mints a fresh single-use code — a tiny
// invitations row; codes expire in 7 days. Direction is decided at
// accept time by who wears a watch, so this sheet never asks.
//
// Voice rules: calm, plain, no "patient"/fear language.

import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { createConnect } from '../services/families/manageInvites';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export interface ConnectShareSheetProps {
  visible: boolean;
  onDismiss: () => void;
  testID?: string;
}

export function ConnectShareSheet({
  visible,
  onDismiss,
  testID = 'connect-share',
}: ConnectShareSheetProps) {
  const theme = useTheme();
  const body = theme.type('bodyM');
  const numeric = theme.type('numericL');

  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await createConnect();
      setCode(result.pairingCode);
    } catch {
      setError("We couldn't get a code right now. Try again in a moment.");
    } finally {
      setPending(false);
    }
  };

  // A fresh code every open; reset stale state from a previous open.
  useEffect(() => {
    if (visible) {
      setCode(null);
      setError(null);
      void generate();
    }
    // generate is re-created per render; depending on `visible` alone is
    // deliberate — the effect fires exactly once per open.
  }, [visible]);

  const handleShare = () => {
    if (!code) return;
    // Code-first AND a working link: /join?code= shows the code on the
    // web landing page and hands it into the app (Phase C link chain).
    const message = `Let's stay connected on Leiko.\n\nTap to join me: https://leiko.app/join?code=${code}\n\nOr open Leiko and enter code ${code}. It works for 7 days.`;
    void Share.share({ title: 'Leiko invite', message });
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      size="compact"
      surface="solid"
      title="Connect with someone"
      testID={testID}
    >
      <View style={[styles.body, { paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l, gap: theme.spacing.m }]}>
        {error ? (
          <>
            <Text
              style={{ color: theme.colors.state.urgent, fontSize: body.size, lineHeight: body.lineHeight, fontFamily: body.family }}
              testID={`${testID}-error`}
            >
              {error}
            </Text>
            <Button variant="primary" onPress={() => void generate()} loading={pending} testID={`${testID}-retry`}>
              Try again
            </Button>
            <Button variant="ghost" onPress={onDismiss} testID={`${testID}-cancel`}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Text style={{ color: theme.colors.text.secondary, fontSize: body.size, lineHeight: body.lineHeight, fontFamily: body.family }}>
              Share this code with the person you want to stay connected
              with. When they enter it in their Leiko app, you&apos;re
              connected — whoever wears a watch shares their readings, and
              the other follows.
            </Text>
            <View
              style={{
                alignItems: 'center',
                paddingVertical: theme.spacing.l,
                backgroundColor: theme.colors.surface.subtle,
                borderRadius: theme.radii.m,
              }}
            >
              {code ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                  accessibilityLabel={`Invite code, ${code.split('').join(' ')}`}
                  style={{ fontFamily: numeric.family, fontSize: 32, letterSpacing: 4, color: theme.colors.text.primary }}
                  testID={`${testID}-code`}
                >
                  {code}
                </Text>
              ) : (
                <Text
                  accessibilityLiveRegion="polite"
                  style={{ color: theme.colors.text.secondary, fontSize: body.size, fontFamily: body.family }}
                  testID={`${testID}-loading`}
                >
                  Getting your code…
                </Text>
              )}
            </View>
            <Text style={{ color: theme.colors.text.tertiary, fontSize: theme.type('caption').size, fontFamily: theme.type('caption').family }}>
              The code works once and expires in 7 days.
            </Text>
            <Button variant="primary" onPress={handleShare} disabled={!code} testID={`${testID}-share`}>
              Share code
            </Button>
            <Button variant="ghost" onPress={onDismiss} testID={`${testID}-done`}>
              Done
            </Button>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 8 },
});
