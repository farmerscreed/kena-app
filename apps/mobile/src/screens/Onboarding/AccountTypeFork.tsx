// AccountTypeFork — ADR-0006 Phase 3 (unified model).
//
// HISTORY: this screen used to fork account_type into 'caregiver' vs
// 'self_buyer', which selected two entirely separate navigation trees and
// home screens. ADR-0006 collapses that: there is ONE unified experience
// (the constellation home where the viewer is a node and can both wear a
// watch and follow people they care for). So both CTAs now onboard the
// user as 'self_buyer' — the self-owning persona that the unified home is
// built on — and the screen reframes from "who are you setting up for?"
// (an identity fork) to a calm welcome that names what Leiko can do.
//
// We keep account_type = 'self_buyer' rather than ripping the column out:
// the root navigator still branches on it, and self_buyer resolves to the
// unified constellation home. Existing 'caregiver' accounts continue to
// work unchanged. account_type is committed at sign-up via
// raw_user_meta_data → handle_new_user; here we just cache the pending
// value in MMKV. (Removing the column / nav branch entirely is a later,
// higher-risk step deliberately deferred per ADR-0006.)
//
// Layout: OnboardingScaffold (center) keeps the welcome vertically
// centered on tall screens and scrollable on short ones / large fonts.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { OnboardingScaffold } from '../../components/OnboardingScaffold';
import { useTheme } from '../../theme';
import { useAuth } from '../../state/auth';
import type { AuthScreenProps } from '../../navigation/types';
import type { AccountType } from '../../types/database';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';

export function AccountTypeForkScreen({ navigation }: AuthScreenProps<'AccountTypeFork'>) {
  const theme = useTheme();
  const setPendingAccountType = useAuth((s) => s.setPendingAccountType);

  const headline = theme.type('displayL');
  const body = theme.type('bodyL');
  const link = theme.type('bodyM');

  // ADR-0006 — every new user onboards as 'self_buyer' (the self-owning
  // persona the unified constellation home is built on). account_type is
  // no longer an identity fork; the user pairs their own watch and/or adds
  // people they care for afterward, on the home.
  const UNIFIED_ACCOUNT_TYPE: AccountType = 'self_buyer';
  const handleContinue = () => {
    setPendingAccountType(UNIFIED_ACCOUNT_TYPE);
    navigation.navigate('SignUp');
  };

  return (
    <OnboardingScaffold center keyboardAware={false} scrollTestID="fork-scroll">
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel="Leiko"
        style={[
          styles.logo,
          {
            backgroundColor: theme.colors.brand.primary,
            borderRadius: theme.radii.full,
            marginBottom: theme.spacing.xxxl,
          },
        ]}
      >
        {/* Decorative brand mark — never font-scale it out of its circle. */}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            color: theme.colors.text.onBrand,
            fontSize: 36,
            fontWeight: '700',
            fontFamily: theme.fontFamily.display,
          }}
        >
          L
        </Text>
      </View>

      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={1.3}
        style={{
          color: theme.colors.text.primary,
          fontSize: headline.size,
          lineHeight: headline.lineHeight,
          fontWeight: headline.weight as '700',
          fontFamily: headline.family,
          textAlign: 'center',
          marginBottom: theme.spacing.m,
        }}
      >
        Welcome to Leiko
      </Text>

      <Text
        maxFontSizeMultiplier={1.5}
        style={{
          color: theme.colors.text.secondary,
          fontSize: body.size,
          lineHeight: body.lineHeight,
          fontWeight: body.weight as '400',
          fontFamily: body.family,
          textAlign: 'center',
          maxWidth: 300,
          marginBottom: theme.spacing.xxxl,
        }}
      >
        Track your own readings and keep an eye on the people you care
        for — all in one place.
      </Text>

      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel="Get started"
        style={{ width: '100%', marginBottom: theme.spacing.xxl }}
      >
        <Button
          variant="primary"
          onPress={handleContinue}
          testID="fork-get-started"
          style={{ width: '100%' }}
        >
          Get started
        </Button>
      </View>

      <Pressable
        onPress={() => navigation.navigate('SignIn')}
        accessibilityRole="link"
        accessibilityLabel="Already have an account? Sign in."
        testID="fork-sign-in"
        hitSlop={theme.spacing.s}
        style={{ paddingVertical: theme.spacing.s }}
      >
        <Text
          maxFontSizeMultiplier={1.5}
          style={{
            fontSize: link.size,
            lineHeight: link.lineHeight,
            fontFamily: link.family,
            textAlign: 'center',
            color: theme.colors.text.secondary,
          }}
        >
          Already have an account?{' '}
          <Text style={{ color: theme.colors.brand.primary, fontWeight: '600' }}>
            Sign in
          </Text>
        </Text>
      </Pressable>
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  logo: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
});
