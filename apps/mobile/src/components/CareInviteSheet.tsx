// CareInviteSheet — "+ Add someone" connect sheet (ADR-0007).
//
// The caregiver types the email of the person whose readings they want
// to follow; createConnect generates a 6-digit code to share. The
// recipient enters the code in their own Leiko app and connect-accept
// resolves direction from watch ownership; if neither wears a watch
// yet, the connect completes automatically when either pairs
// (migration 0051).
//
// Phase A 2026-08-14: the share message is CODE-FIRST. The old primary
// CTA was a leiko.app/join?token= link that could not be redeemed at
// any layer (web fallback drops the query; the app only acts on code=;
// no backend reads url_token). Links return in Phase C, fixed properly.
//
// Voice rules: calm, plain, no "patient"/fear language.

import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { useTheme } from '../theme';
import { createConnect } from '../services/families/manageInvites';

export interface CareInviteSheetProps {
  visible: boolean;
  onDismiss: () => void;
  testID?: string;
}

export function CareInviteSheet({ visible, onDismiss, testID = 'care-invite-sheet' }: CareInviteSheetProps) {
  const theme = useTheme();
  const body = theme.type('bodyM');
  const numeric = theme.type('numericL');

  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setEmail('');
      setLabel('');
      setPending(false);
      setError(null);
      setCode(null);
    }
  }, [visible]);

  const handleSend = async () => {
    if (pending) return;
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      setError('Enter a valid email so we can send the invite.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await createConnect({
        inviteeEmail: trimmed,
        inviteeLabel: label.trim() || undefined,
      });
      setCode(result.pairingCode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        /invalid_email/i.test(msg)
          ? 'That email doesn’t look right. Check it and try again.'
          : "We couldn't create that invite. Please try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const handleShare = () => {
    // Code-first (Phase A): the code is the one thing that works
    // everywhere. The install link points at the download hub, not the
    // broken /join deep link.
    const message = `I'd love to keep a gentle eye on your readings with Leiko.\n\nEnter invite code ${code} in the Leiko app and we'll be connected.\n\nNew to Leiko? Get it at https://leiko.app/app, then enter the code. It works for 7 days.`;
    void Share.share({ title: 'Leiko invite', message });
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      size="compact"
      surface="solid"
      title={code ? 'Invite ready' : 'Add someone you care for'}
      testID={testID}
    >
      <View style={[styles.body, { paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l, gap: theme.spacing.m }]}>
        {code ? (
          <>
            <Text style={{ color: theme.colors.text.secondary, fontSize: body.size, lineHeight: body.lineHeight, fontFamily: body.family }}>
              Share this with the person you care for. When they set up Leiko
              and enter the code, you’ll start following their readings.
            </Text>
            <View
              style={{
                alignItems: 'center',
                paddingVertical: theme.spacing.l,
                backgroundColor: theme.colors.surface.subtle,
                borderRadius: theme.radii.m,
              }}
            >
              <Text
                allowFontScaling={false}
                accessibilityLabel={`Invite code, ${code.split('').join(' ')}`}
                style={{ fontFamily: numeric.family, fontSize: 32, letterSpacing: 4, color: theme.colors.text.primary }}
                testID="care-invite-code"
              >
                {code}
              </Text>
            </View>
            <Button variant="primary" onPress={handleShare} testID="care-invite-share">
              Share invite
            </Button>
            <Button variant="ghost" onPress={onDismiss} testID="care-invite-done">
              Done
            </Button>
          </>
        ) : (
          <>
            <Text style={{ color: theme.colors.text.primary, fontSize: body.size, lineHeight: body.lineHeight, fontFamily: body.family, fontStyle: 'italic' }}>
              “Let me keep an eye on Mum.”
            </Text>
            <Text style={{ color: theme.colors.text.secondary, fontSize: body.size, lineHeight: body.lineHeight, fontFamily: body.family }}>
              Invite someone whose readings you’d like to follow. We’ll create
              a 6-digit code to share; they enter it in their own Leiko app.
            </Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Their first name (optional)"
              placeholderTextColor={theme.colors.text.tertiary}
              style={inputStyle(theme)}
              testID="care-invite-label-input"
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Their email"
              placeholderTextColor={theme.colors.text.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={inputStyle(theme)}
              testID="care-invite-email-input"
            />
            {error ? (
              <Text style={{ color: theme.colors.state.urgent, fontSize: body.size, fontFamily: body.family }} testID="care-invite-error">
                {error}
              </Text>
            ) : null}
            <Button variant="primary" onPress={handleSend} loading={pending} testID="care-invite-send">
              Send invite
            </Button>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

function inputStyle(theme: ReturnType<typeof useTheme>) {
  const body = theme.type('bodyL');
  return {
    borderWidth: 1,
    borderColor: theme.colors.border.rim,
    borderRadius: theme.radii.m,
    paddingHorizontal: theme.spacing.l,
    paddingVertical: theme.spacing.m,
    color: theme.colors.text.primary,
    fontSize: body.size,
    fontFamily: body.family,
    backgroundColor: theme.colors.surface.base,
  } as const;
}

const styles = StyleSheet.create({
  body: { paddingTop: 8 },
});
