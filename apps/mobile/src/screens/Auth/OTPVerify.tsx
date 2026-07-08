// OTPVerify — 6-digit code entry. On success, useAuth.verifyOtp resolves
// and the auth listener flips status to 'authenticated'; the navigator
// re-evaluates and routes to the persona stack. We do NOT navigate
// imperatively here — the navigator owns route selection.
//
// On failure we surface a calm message and let the user retry. The
// "Resend code" affordance simply re-runs signInWithOtp / signUpWithOtp
// for the same email.

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { OnboardingScaffold } from '../../components/OnboardingScaffold';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/auth';
import type { AuthScreenProps } from '../../navigation/types';

const CODE_RE = /^\d{6}$/;

export function OTPVerifyScreen({ navigation, route }: AuthScreenProps<'OTPVerify'>) {
  const { email, mode } = route.params;
  const theme = useTheme();
  const verifyOtp = useAuth((s) => s.verifyOtp);
  const signUpWithOtp = useAuth((s) => s.signUpWithOtp);
  const signInWithOtp = useAuth((s) => s.signInWithOtp);

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Sprint 19 Block 9 — render a brief "Welcome back" success view
  // between verifyOtp resolving and the navigator transitioning. The
  // 700ms delayMs on verifyOtp gives the user a visible moment of
  // closure instead of an instant screen swap.
  const [verified, setVerified] = useState(false);

  const valid = CODE_RE.test(code);

  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');
  const caption = theme.type('caption');

  const handleVerify = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      // Mark verified BEFORE the await — the success view renders
      // while the 700ms delay inside verifyOtp ticks.
      setVerified(true);
      await verifyOtp(email, code, { delayMs: 700 });
      // Navigator will reroute on the auth-state change. No explicit
      // navigate() here. (We don't reset `verified` either — the
      // screen unmounts on the next render.)
    } catch (e) {
      setVerified(false);
      setError(
        e instanceof Error && e.message.includes('Token')
          ? "That code didn't work. Check the email and try again."
          : "We couldn't verify the code. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Sprint 19 Block 9 — "Use a different email" → back to the
  // screen that owns the email entry for this mode. signin → SignIn;
  // signup → AccountTypeFork (so the user can re-pick the persona too).
  const handleDifferentEmail = () => {
    if (mode === 'signin') {
      navigation.navigate('SignIn');
    } else {
      navigation.navigate('AccountTypeFork');
    }
  };

  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signup') await signUpWithOtp(email);
      else await signInWithOtp(email);
      setInfo('We sent another code.');
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't resend. Try again in a minute.");
    } finally {
      setResending(false);
    }
  };

  return (
    <OnboardingScaffold onBack={() => navigation.goBack()} scrollTestID="otp-scroll">
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
        {verified
          ? mode === 'signin'
            ? 'Welcome back.'
            : 'You’re in.'
          : 'Check your email'}
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
        {verified ? (
          mode === 'signin' ? (
            <>Loading your home…</>
          ) : (
            <>Setting things up for{' '}
            <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>{email}</Text>
            .</>
          )
        ) : (
          <>We sent a 6-digit code to{' '}
          <Text style={{ color: theme.colors.text.primary, fontWeight: '600' }}>{email}</Text>
          .</>
        )}
      </Text>

      {!verified ? (
        <>
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
            6-digit code
          </Text>

          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))}
            placeholder="123456"
            placeholderTextColor={theme.colors.text.secondary}
            keyboardType="number-pad"
            inputMode="numeric"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            returnKeyType="go"
            onSubmitEditing={handleVerify}
            maxLength={6}
            accessibilityLabel="6-digit code"
            testID="otp-code"
            style={{
              backgroundColor: theme.colors.surface.elevated,
              borderRadius: theme.radii.m,
              paddingHorizontal: theme.spacing.l,
              paddingVertical: theme.spacing.m,
              fontSize: 28,
              letterSpacing: 4,
              fontFamily: theme.fontFamily.numeric,
              color: theme.colors.text.primary,
              borderWidth: 1,
              borderColor: error ? theme.colors.state.urgent : theme.colors.border.default,
              minHeight: theme.minTapTarget,
              textAlign: 'center',
            }}
          />

          {/* Sprint 19 Block 9 UX-C — tiny digit-count indicator
              under the input so the user can see at a glance
              how many more digits they need. */}
          <Text
            maxFontSizeMultiplier={1.5}
            style={{
              color: theme.colors.text.secondary,
              fontSize: caption.size,
              fontFamily: theme.fontFamily.numeric,
              textAlign: 'right',
              marginTop: theme.spacing.xs,
              letterSpacing: 0.3,
            }}
            testID="otp-digit-count"
          >
            {code.length} / 6
          </Text>
        </>
      ) : null}

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
      {info ? (
        <Text
          accessibilityLiveRegion="polite"
          maxFontSizeMultiplier={1.5}
          style={{
            color: theme.colors.text.secondary,
            fontSize: label.size,
            fontFamily: label.family,
            marginTop: theme.spacing.s,
          }}
        >
          {info}
        </Text>
      ) : null}

      <View style={{ height: theme.spacing.xxxl }} />

      {!verified ? (
        <>
          <Button
            variant="primary"
            onPress={handleVerify}
            disabled={!valid}
            loading={submitting}
            testID="otp-submit"
            style={{ width: '100%' }}
          >
            Verify
          </Button>

          <View style={{ height: theme.spacing.l }} />

          <Pressable
            onPress={handleResend}
            disabled={resending}
            accessibilityRole="button"
            accessibilityLabel="Resend code"
            testID="otp-resend"
            hitSlop={theme.spacing.s}
            style={{ paddingVertical: theme.spacing.s, alignItems: 'center' }}
          >
            <Text
              maxFontSizeMultiplier={1.5}
              style={{
                color: theme.colors.brand.primary,
                fontSize: body.size,
                fontFamily: body.family,
                opacity: resending ? theme.opacity.disabled : 1,
              }}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </Text>
          </Pressable>

          {/* Sprint 19 Block 9 UX-A — "Use a different email"
              link. Pre-Block-9 the only escape was tapping Back
              twice (OTP → SignUp/SignIn → Fork). */}
          <Pressable
            onPress={handleDifferentEmail}
            accessibilityRole="button"
            accessibilityLabel="Use a different email"
            testID="otp-different-email"
            hitSlop={theme.spacing.s}
            style={{
              paddingVertical: theme.spacing.s,
              alignItems: 'center',
              marginTop: theme.spacing.s,
            }}
          >
            <Text
              maxFontSizeMultiplier={1.5}
              style={{
                color: theme.colors.text.secondary,
                fontSize: body.size,
                fontFamily: body.family,
              }}
            >
              Use a different email
            </Text>
          </Pressable>
        </>
      ) : null}
    </OnboardingScaffold>
  );
}
