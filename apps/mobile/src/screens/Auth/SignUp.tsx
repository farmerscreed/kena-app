// SignUp — captures the email for a new account, then sends a 6-digit OTP.
// The pendingAccountType (set on the fork screen) is forwarded to
// signInWithOtp's options.data so handle_new_user can stamp it onto
// public.users at first insert.

import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Button } from '../../components/Button';
import { OnboardingScaffold } from '../../components/OnboardingScaffold';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/auth';
import type { AuthScreenProps } from '../../navigation/types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignUpScreen({ navigation }: AuthScreenProps<'SignUp'>) {
  const theme = useTheme();
  const signUpWithOtp = useAuth((s) => s.signUpWithOtp);
  const pendingAccountType = useAuth((s) => s.pendingAccountType);

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim();
  const valid = EMAIL_RE.test(trimmed) && pendingAccountType !== null;

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');

  const handleSubmit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await signUpWithOtp(trimmed);
      navigation.navigate('OTPVerify', { email: trimmed, mode: 'signup' });
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't send your code. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OnboardingScaffold
      onBack={() => navigation.goBack()}
      scrollTestID="signup-scroll"
      footer={
        <Button
          variant="primary"
          onPress={handleSubmit}
          disabled={!valid}
          loading={submitting}
          testID="signup-submit"
          style={{ width: '100%' }}
        >
          Send code
        </Button>
      }
    >
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
        What's your email?
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
        We'll send you a 6-digit code to sign in. No password to remember.
      </Text>

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: label.size,
          fontWeight: label.weight as '500',
          fontFamily: label.family,
          marginBottom: theme.spacing.s,
        }}
      >
        Email
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={theme.colors.text.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        returnKeyType="go"
        onSubmitEditing={handleSubmit}
        accessibilityLabel="Email address"
        testID="signup-email"
        style={{
          backgroundColor: theme.colors.surface.elevated,
          borderRadius: theme.radii.m,
          paddingHorizontal: theme.spacing.l,
          paddingVertical: theme.spacing.m,
          fontSize: body.size,
          fontFamily: body.family,
          color: theme.colors.text.primary,
          borderWidth: 1,
          borderColor: error ? theme.colors.state.urgent : theme.colors.border.default,
          minHeight: theme.minTapTarget,
        }}
      />

      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.5}
          style={{
            color: theme.colors.state.urgent,
            fontSize: label.size,
            fontFamily: label.family,
            marginTop: theme.spacing.s,
          }}
        >
          {error}
        </Text>
      ) : null}
    </OnboardingScaffold>
  );
}
