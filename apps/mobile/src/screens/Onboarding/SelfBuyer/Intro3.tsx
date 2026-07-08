// Self-Buyer Intro 3 — docs/04-screens/self-buyer-onboarding.md §4.2.6
// (D8a §3.3). Final intro; primary CTA continues into the form.
// Sprint 16.6: presentation handled by OnboardingHero (D11 premium pattern).

import { ChartLineUpIcon } from 'phosphor-react-native';
import { OnboardingHero } from '../../../components/OnboardingHero';
import type { SelfBuyerOnboardingScreenProps } from '../../../navigation/types';

export function SelfBuyerIntro3Screen({
  navigation,
}: SelfBuyerOnboardingScreenProps<'Intro3'>) {
  return (
    <OnboardingHero
      icon={ChartLineUpIcon}
      iconAccessibilityLabel="A hand passing a folded note across a table"
      headline="See the trends. Share them with a doctor."
      body="A clear weekly summary, the kind that's easy to save and bring to an appointment."
      pageCurrent={3}
      pageTotal={3}
      pagerTestID="self-buyer-intro-pager"
      onBack={() => navigation.goBack()}
      primary={{
        label: 'Continue',
        onPress: () => navigation.navigate('You'),
        testID: 'self-buyer-intro3-continue',
      }}
      skip={{
        label: 'Skip',
        onPress: () => navigation.navigate('You'),
        testID: 'self-buyer-intro3-skip',
      }}
    />
  );
}
