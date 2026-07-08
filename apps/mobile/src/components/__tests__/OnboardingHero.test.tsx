// OnboardingHero — layout regression guard.
//
// The intro screens (caregiver + self-buyer × 3) render through
// OnboardingHero. It used to lay content out in a fixed, non-scrolling
// View: on a short viewport or with a large OS font, the hero + headline
// + body pushed the primary CTA off-screen with no way to reach it —
// which blocked onboarding entirely on smaller phones. These tests lock
// in the fix: the content lives inside a ScrollView, and the CTA is a
// descendant of it (i.e. always reachable by scrolling).

import { type ReactNode } from 'react';
import { PulseIcon } from 'phosphor-react-native';
import { render, screen, within, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { OnboardingHero } from '../OnboardingHero';

// Deliberately small viewport — the class of device where the bug showed.
function withProviders(ui: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 568 },
        insets: { top: 24, left: 0, right: 0, bottom: 16 },
      }}
    >
      <ThemeProvider mode="caregiver">{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function renderHero(overrides?: { skip?: boolean; onBack?: () => void }) {
  const onPrimary = jest.fn();
  const onSkip = jest.fn();
  render(
    withProviders(
      <OnboardingHero
        icon={PulseIcon}
        headline="A long headline that would overflow a short viewport on its own"
        body="A body paragraph long enough that, combined with the 220pt hero and the headline, the content exceeds a small phone's height."
        pageCurrent={1}
        pageTotal={3}
        pagerTestID="test-pager"
        primary={{ label: 'Continue', onPress: onPrimary, testID: 'hero-primary' }}
        skip={overrides?.skip ? { label: 'Skip', onPress: onSkip, testID: 'hero-skip' } : undefined}
        onBack={overrides?.onBack}
      />,
    ),
  );
  return { onPrimary, onSkip };
}

describe('OnboardingHero — scroll reachability', () => {
  it('renders its content inside a scroll container', () => {
    renderHero();
    expect(screen.getByTestId('onboarding-hero-scroll')).toBeTruthy();
  });

  it('keeps the primary CTA inside the scroll container (always reachable)', () => {
    renderHero();
    const scroll = screen.getByTestId('onboarding-hero-scroll');
    // The CTA being a descendant of the ScrollView is what guarantees it can
    // never be stranded off-screen the way the old fixed layout allowed.
    expect(within(scroll).getByTestId('hero-primary')).toBeTruthy();
  });

  it('primary CTA fires its handler', () => {
    const { onPrimary } = renderHero();
    fireEvent.press(screen.getByTestId('hero-primary'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('optional skip CTA also lives inside the scroll container', () => {
    renderHero({ skip: true });
    const scroll = screen.getByTestId('onboarding-hero-scroll');
    expect(within(scroll).getByTestId('hero-skip')).toBeTruthy();
  });

  it('renders a back affordance that fires onBack when provided', () => {
    const onBack = jest.fn();
    renderHero({ onBack });
    fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('omits the back affordance when onBack is not provided', () => {
    renderHero();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });
});
