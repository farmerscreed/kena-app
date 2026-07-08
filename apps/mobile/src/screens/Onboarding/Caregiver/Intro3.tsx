// Caregiver Intro 3 — docs/04-screens/caregiver-onboarding.md §4.2 (sub-screen 3).
// Skip and Continue both route to FamilyYou (the first form screen) per spec.
// Sprint 16.6: presentation handled by OnboardingHero (D11 premium pattern).

import { UsersThreeIcon } from 'phosphor-react-native';
import { OnboardingHero } from '../../../components/OnboardingHero';
import type { CaregiverOnboardingScreenProps } from '../../../navigation/types';

export function CaregiverIntro3Screen({
  navigation,
}: CaregiverOnboardingScreenProps<'Intro3'>) {
  return (
    <OnboardingHero
      icon={UsersThreeIcon}
      iconAccessibilityLabel="A caregiver and a parent, sharing a moment"
      headline="You drive. They wear."
      body="You set up the watch and pay. They wear it and tap once a day. Everyone sees the same readings."
      pageCurrent={3}
      pageTotal={3}
      pagerTestID="caregiver-intro-pager"
      onBack={() => navigation.goBack()}
      primary={{
        label: 'Continue',
        onPress: () => navigation.navigate('FamilyYou'),
        testID: 'caregiver-intro3-continue',
      }}
      skip={{
        label: 'Skip',
        onPress: () => navigation.navigate('FamilyYou'),
        testID: 'caregiver-intro3-skip',
      }}
    />
  );
}
