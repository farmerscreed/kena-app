// OnboardingScaffold — contract tests. This wrapper's whole reason to
// exist is guaranteeing onboarding content is always inside a ScrollView
// (so a CTA can't be stranded off-screen) with a consistent back link and
// bottom-anchored footer. These tests lock that contract in.

import { type ReactNode } from 'react';
import { Text } from 'react-native';
import { render, screen, within, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { OnboardingScaffold } from '../OnboardingScaffold';

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

describe('OnboardingScaffold', () => {
  it('renders children inside the scroll container', () => {
    render(
      withProviders(
        <OnboardingScaffold scrollTestID="sc">
          <Text testID="child">hello</Text>
        </OnboardingScaffold>,
      ),
    );
    expect(within(screen.getByTestId('sc')).getByTestId('child')).toBeTruthy();
  });

  it('keeps the footer inside the scroll container (always reachable)', () => {
    render(
      withProviders(
        <OnboardingScaffold scrollTestID="sc" footer={<Text testID="cta">go</Text>}>
          <Text>body</Text>
        </OnboardingScaffold>,
      ),
    );
    expect(within(screen.getByTestId('sc')).getByTestId('cta')).toBeTruthy();
  });

  it('renders a Back link that fires onBack', () => {
    const onBack = jest.fn();
    render(
      withProviders(
        <OnboardingScaffold onBack={onBack}>
          <Text>body</Text>
        </OnboardingScaffold>,
      ),
    );
    fireEvent.press(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('omits the Back link when onBack is not provided', () => {
    render(
      withProviders(
        <OnboardingScaffold>
          <Text>body</Text>
        </OnboardingScaffold>,
      ),
    );
    expect(screen.queryByLabelText('Back')).toBeNull();
  });
});
