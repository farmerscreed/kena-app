// Caregiver Intro 2 — docs/04-screens/caregiver-onboarding.md §4.2 (sub-screen 2).
// Skip becomes available here. Skip routes directly to FamilyYou (sub-screen 4).
// Sprint 16.6: presentation handled by OnboardingHero (D11 premium pattern).

import { WatchIcon } from 'phosphor-react-native';
import { OnboardingHero } from '../../../components/OnboardingHero';
import type { CaregiverOnboardingScreenProps } from '../../../navigation/types';

export function CaregiverIntro2Screen({
  navigation,
}: CaregiverOnboardingScreenProps<'Intro2'>) {
  return (
    <OnboardingHero
      icon={WatchIcon}
      iconAccessibilityLabel="A watch on a wrist, calm"
      headline="Their watch. Your peace of mind."
      body="When your parent's blood pressure changes, we let you know — gently. No surveillance, no panic."
      pageCurrent={2}
      pageTotal={3}
      pagerTestID="caregiver-intro-pager"
      onBack={() => navigation.goBack()}
      primary={{
        label: 'Continue',
        onPress: () => navigation.navigate('Intro3'),
        testID: 'caregiver-intro2-continue',
      }}
      skip={{
        label: 'Skip',
        onPress: () => navigation.navigate('FamilyYou'),
        testID: 'caregiver-intro2-skip',
      }}
    />
  );
}
