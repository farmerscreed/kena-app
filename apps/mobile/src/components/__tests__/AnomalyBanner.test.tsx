import { type ReactNode } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  AnomalyBanner,
  type AnomalyBannerSeverity,
} from '../AnomalyBanner';

// Voice-compliant test fixtures (docs/05-voice-and-claims.md). No "patient",
// no "diagnose", no fear language. Calm-concerned uses tone C; confirmed-
// urgent uses tone D ("direct" but still calm).
const FIXTURES: Record<AnomalyBannerSeverity, { title: string; body: string }> = {
  'calm-concerned': {
    title: 'Worth a chat with Mum',
    body: "We've noticed a pattern worth a gentle check-in.",
  },
  'confirmed-urgent': {
    title: 'Talk to Mum now',
    body: 'Their latest reading was above their usual range. A calm check-in helps.',
  },
};

function withTheme(
  ui: ReactNode,
  colorMode: 'dark' | 'light' = 'dark',
  typeMode: 'caregiver' | 'parent' = 'caregiver',
) {
  return (
    <ThemeProvider mode={typeMode} colorMode={colorMode}>
      {ui}
    </ThemeProvider>
  );
}

describe('AnomalyBanner — severity × colorMode snapshot matrix', () => {
  const severities: AnomalyBannerSeverity[] = [
    'calm-concerned',
    'confirmed-urgent',
  ];
  const modes: Array<'dark' | 'light'> = ['dark', 'light'];

  for (const mode of modes) {
    for (const severity of severities) {
      it(`renders severity=${severity} mode=${mode}`, () => {
        const fixture = FIXTURES[severity];
        const { toJSON } = render(
          withTheme(
            <AnomalyBanner
              severity={severity}
              title={fixture.title}
              body={fixture.body}
              testID="banner"
            />,
            mode,
          ),
        );
        expect(toJSON()).toMatchSnapshot();
      });
    }
  }
});

describe('AnomalyBanner — icon mapping', () => {
  it('renders the calm-concerned icon for severity=calm-concerned', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner-icon')).toBeTruthy();
  });

  it('renders the confirmed-urgent icon for severity=confirmed-urgent', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner-icon')).toBeTruthy();
  });
});

describe('AnomalyBanner — dismiss affordance', () => {
  it('renders the dismiss X for calm-concerned when onDismiss is provided', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          onDismiss={() => undefined}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner-dismiss')).toBeTruthy();
  });

  it('does NOT render the dismiss X for calm-concerned when onDismiss is omitted', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.queryByTestId('banner-dismiss')).toBeNull();
  });

  it('does NOT render the dismiss X for confirmed-urgent even when onDismiss is provided', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          onDismiss={() => undefined}
          testID="banner"
        />,
      ),
    );
    expect(screen.queryByTestId('banner-dismiss')).toBeNull();
  });

  it('fires onDismiss when the dismiss X is pressed', () => {
    const onDismiss = jest.fn();
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          onDismiss={onDismiss}
          testID="banner"
        />,
      ),
    );
    fireEvent.press(screen.getByTestId('banner-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('AnomalyBanner — CTA', () => {
  it('renders the CTA when provided and fires its onPress', () => {
    const onPress = jest.fn();
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          cta={{ label: 'Open trends', onPress }}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByText('Open trends')).toBeTruthy();
    fireEvent.press(screen.getByTestId('banner-cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not render a CTA region when cta is omitted', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.queryByTestId('banner-cta')).toBeNull();
  });
});

describe('AnomalyBanner — accessibility', () => {
  it('sets accessibilityRole="alert" on the root', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner').props.accessibilityRole).toBe('alert');
  });

  it('sets accessibilityLiveRegion="polite" for calm-concerned', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner').props.accessibilityLiveRegion).toBe(
      'polite',
    );
  });

  it('sets accessibilityLiveRegion="assertive" for confirmed-urgent', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner').props.accessibilityLiveRegion).toBe(
      'assertive',
    );
  });

  it('composes accessibilityLabel from severity, title, and body for calm-concerned', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner').props.accessibilityLabel).toBe(
      "Worth-a-chat alert: Worth a chat with Mum. We've noticed a pattern worth a gentle check-in.",
    );
  });

  it('composes accessibilityLabel from severity, title, and body for confirmed-urgent', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(screen.getByTestId('banner').props.accessibilityLabel).toBe(
      'Urgent alert: Talk to Mum now. Their latest reading was above their usual range. A calm check-in helps.',
    );
  });
});

// ── Audit P1-7 ───────────────────────────────────────────────────────
// accessibilityLiveRegion is Android-only in React Native. On iOS this
// banner set "assertive" and then said nothing at all — a VoiceOver user
// was never told a reading had been flagged. The banner now also posts
// the composed sentence through AccessibilityInfo on iOS, and stays quiet
// on Android so the reading isn't doubled up.

describe('AnomalyBanner — live-region announcement (audit P1-7)', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    jest.restoreAllMocks();
  });

  it('speaks the confirmed-urgent banner on iOS', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(spy).toHaveBeenCalledWith(
      screen.getByTestId('banner').props.accessibilityLabel,
    );
  });

  it('speaks the calm-concerned banner on iOS', () => {
    render(
      withTheme(
        <AnomalyBanner
          severity="calm-concerned"
          title={FIXTURES['calm-concerned'].title}
          body={FIXTURES['calm-concerned'].body}
          testID="banner"
        />,
      ),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      screen.getByTestId('banner').props.accessibilityLabel,
    );
  });

  it('stays quiet on Android — accessibilityLiveRegion already announces there', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(spy).not.toHaveBeenCalled();
    // The Android half of the contract is still in place.
    expect(screen.getByTestId('banner').props.accessibilityLiveRegion).toBe(
      'assertive',
    );
  });

  it('does not repeat itself on a re-render with unchanged copy', () => {
    const { rerender } = render(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    rerender(
      withTheme(
        <AnomalyBanner
          severity="confirmed-urgent"
          title={FIXTURES['confirmed-urgent'].title}
          body={FIXTURES['confirmed-urgent'].body}
          testID="banner"
        />,
      ),
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
