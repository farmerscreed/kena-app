// FamilyWatch — Sprint 3 acceptance tests.
//
// Bar (per docs/04-screens/caregiver-onboarding.md §4.4.3):
//   - Headline + body render verbatim
//   - "I have the watch with me" tappable; calls completeWithWatchInHand
//   - "Ship one to them" disabled with "Coming soon" pill
//   - Voice gate

import { type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { CaregiverFamilyWatchScreen } from '../Onboarding/Caregiver/FamilyWatch';
import { useOnboarding } from '../../state/onboarding';
import type { CaregiverOnboardingScreenProps } from '../../navigation/types';

const mockComplete = jest.fn();

jest.mock('../../state/onboarding', () => {
  // Lazy requireActual: state/onboarding and state/auth import each
  // other, so resolving the real module at factory time re-enters this
  // factory mid-definition (which import wins depends on the import
  // order of the screen under test). Deferring to first USE lets the
  // cycle finish loading first.
  const getActual = () =>
    jest.requireActual('../../state/onboarding') as typeof import('../../state/onboarding');
  const getStateWithMock = () => ({
    ...getActual().useOnboarding.getState(),
    completeWithWatchInHand: mockComplete,
  });
  return {
    useOnboarding: Object.assign(
      <T,>(selector: (s: ReturnType<typeof getStateWithMock>) => T) =>
        selector(getStateWithMock()),
      {
        getState: getStateWithMock,
        setState: (...args: unknown[]) =>
          (getActual().useOnboarding.setState as (...a: unknown[]) => void)(...args),
      },
    ),
  };
});

function withProviders(ui: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 320, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver">{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function makeNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as unknown as CaregiverOnboardingScreenProps<'FamilyWatch'>['navigation'];
}

function makeRoute() {
  return { key: 'k', name: 'FamilyWatch' as const, params: undefined } as unknown as CaregiverOnboardingScreenProps<'FamilyWatch'>['route'];
}

beforeEach(() => {
  mockComplete.mockReset();
  useOnboarding.setState({
    caregiver: { displayName: 'Tunde', relationship: 'son' },
    parent: {
      displayName: 'Mama Linda',
      relationship: 'mother',
      relationshipCustom: null,
      timezone: 'Africa/Lagos',
    },
    familyId: null,
    caregiverOnboardingComplete: false,
    finalizing: false,
    finalizeError: null,
  });
});

describe('FamilyWatch — copy', () => {
  it('renders the headline and body verbatim', () => {
    render(
      withProviders(
        <CaregiverFamilyWatchScreen navigation={makeNav()} route={makeRoute()} />,
      ),
    );
    expect(screen.getByText("Where's the watch right now?")).toBeTruthy();
    expect(
      screen.getByText("We'll set it up the right way for where it lives."),
    ).toBeTruthy();
  });

  it('renders both card titles', () => {
    render(
      withProviders(
        <CaregiverFamilyWatchScreen navigation={makeNav()} route={makeRoute()} />,
      ),
    );
    expect(screen.getByText('I have the watch with me')).toBeTruthy();
    expect(screen.getByText('Ship one to them')).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });
});

describe('FamilyWatch — interaction', () => {
  it("'I have the watch' calls completeWithWatchInHand", async () => {
    mockComplete.mockResolvedValueOnce(undefined);
    render(
      withProviders(
        <CaregiverFamilyWatchScreen navigation={makeNav()} route={makeRoute()} />,
      ),
    );

    fireEvent.press(screen.getByTestId('family-watch-have'));

    await waitFor(() => {
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces finalizeError when the completion fails', async () => {
    mockComplete.mockRejectedValueOnce(new Error('boom'));
    useOnboarding.setState({ finalizeError: 'Network is offline. Try again.' });

    render(
      withProviders(
        <CaregiverFamilyWatchScreen navigation={makeNav()} route={makeRoute()} />,
      ),
    );

    expect(screen.getByTestId('family-watch-error')).toBeTruthy();
    expect(screen.getByText('Network is offline. Try again.')).toBeTruthy();
  });
});

describe('FamilyWatch — voice gate', () => {
  it('has no forbidden phrases', () => {
    render(
      withProviders(
        <CaregiverFamilyWatchScreen navigation={makeNav()} route={makeRoute()} />,
      ),
    );
    const FORBIDDEN = [
      'patient',
      'loved one',
      'diagnose',
      'predict',
      'medical advice',
      "don't wait",
      'silent killer',
      'critical level',
    ];
    for (const term of FORBIDDEN) {
      expect(screen.queryByText(new RegExp(term, 'i'))).toBeNull();
    }
  });
});
