// Self-Buyer Intro 2 — docs/04-screens/self-buyer-onboarding.md §4.2.5
// (D8a §3.3). Skip becomes available here; routes to You.
// Sprint 16.6: presentation handled by OnboardingHero (D11 premium pattern).

import { StethoscopeIcon } from 'phosphor-react-native';
import { OnboardingHero } from '../../../components/OnboardingHero';
import type { SelfBuyerOnboardingScreenProps } from '../../../navigation/types';

export function SelfBuyerIntro2Screen({
  navigation,
}: SelfBuyerOnboardingScreenProps<'Intro2'>) {
  return (
    <OnboardingHero
      icon={StethoscopeIcon}
      iconAccessibilityLabel="A watch beside a stylised arm-cuff, equally weighted"
      headline="As accurate as your doctor's cuff."
      body="The watch uses an inflatable cuff — the same method clinicians use — measured from the wrist."
      pageCurrent={2}
      pageTotal={3}
      pagerTestID="self-buyer-intro-pager"
      onBack={() => navigation.goBack()}
      primary={{
        label: 'Continue',
        onPress: () => navigation.navigate('Intro3'),
        testID: 'self-buyer-intro2-continue',
      }}
      skip={{
        label: 'Skip',
        onPress: () => navigation.navigate('You'),
        testID: 'self-buyer-intro2-skip',
      }}
    />
  );
}
