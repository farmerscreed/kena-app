import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  DailyPulseHero,
  type DailyPulseHeroVitals,
} from '../DailyPulseHero';

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

const SAMPLE_VITALS: DailyPulseHeroVitals = {
  bp: { fill: 0.75, display: '128/82', unit: 'mmHg' },
  hr: { fill: 0.4, display: '64', unit: 'bpm' },
  spo2: { fill: 0.85, display: '98', unit: '%' },
  sleep: { fill: 0.6, display: '7:42', unit: 'hrs' },
  activity: { fill: 0.5, display: '4,166', unit: 'steps' },
};

const FRESH_BP = {
  label: 'Blood pressure',
  value: '128/82',
  sub: 'mmHg · 6:42 am',
} as const;

describe('DailyPulseHero — render', () => {
  it('renders the central value + label inside the BP ring', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          parentName="Mum"
          testID="hero"
        />,
      ),
    );
    expect(screen.getByText('128/82')).toBeTruthy();
    expect(screen.getByText('Blood pressure')).toBeTruthy();
    expect(screen.getByText('mmHg · 6:42 am')).toBeTruthy();
  });

  it('renders each satellite vital with its display + unit', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          testID="hero"
        />,
      ),
    );
    // HR satellite — 64 bpm.
    expect(screen.getByText('64')).toBeTruthy();
    expect(screen.getByText('bpm')).toBeTruthy();
    // SpO2 satellite — 98 %.
    expect(screen.getByText('98')).toBeTruthy();
    expect(screen.getByText('%')).toBeTruthy();
    // Sleep satellite — 7:42 hrs.
    expect(screen.getByText('7:42')).toBeTruthy();
    expect(screen.getByText('hrs')).toBeTruthy();
    // Activity satellite — 4,166 steps.
    expect(screen.getByText('4,166')).toBeTruthy();
    expect(screen.getByText('steps')).toBeTruthy();
  });

  it('renders the AI narration when provided', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          aiNarration="Mum is in pattern. 124/79 this morning, six below her week."
          testID="hero"
        />,
      ),
    );
    expect(
      screen.getByText('Mum is in pattern. 124/79 this morning, six below her week.'),
    ).toBeTruthy();
  });

  it('omits the narration when aiNarration is undefined', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={{ label: 'No readings yet today', value: '—' }}
          testID="hero"
        />,
      ),
    );
    expect(screen.queryByText(/in pattern/)).toBeNull();
  });
});

describe('DailyPulseHero — interaction', () => {
  it('fires onSelectVital("bp") when the central ring is tapped', () => {
    const onSelectVital = jest.fn();
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          onSelectVital={onSelectVital}
          testID="hero"
        />,
      ),
    );
    fireEvent.press(screen.getByTestId('hero-bp'));
    expect(onSelectVital).toHaveBeenCalledWith('bp');
  });

  it('fires onSelectVital with the satellite vital when a satellite is tapped', () => {
    const onSelectVital = jest.fn();
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          onSelectVital={onSelectVital}
          testID="hero"
        />,
      ),
    );
    fireEvent.press(screen.getByTestId('hero-hr'));
    expect(onSelectVital).toHaveBeenCalledWith('hr');
    fireEvent.press(screen.getByTestId('hero-sleep'));
    expect(onSelectVital).toHaveBeenCalledWith('sleep');
  });
});

describe('DailyPulseHero — accessibility composition (D12 §11.2.3)', () => {
  it('reads "Daily pulse for {parentName}" when parentName is provided', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          parentName="Mum"
          testID="hero"
        />,
      ),
    );
    // The composed label sits on the inner canvas node, not the testID
    // root. Check whichever child carries it.
    const matches = screen.UNSAFE_root.findAll((n: { props: { accessibilityLabel?: unknown } }) =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith('Daily pulse for Mum'),
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it('falls back to "Daily pulse" without a parentName', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          testID="hero"
        />,
      ),
    );
    const matches = screen.UNSAFE_root.findAll((n: { props: { accessibilityLabel?: unknown } }) =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith('Daily pulse.'),
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it('includes the central value + label and every satellite vital', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          testID="hero"
        />,
      ),
    );
    const node = screen.UNSAFE_root.findAll((n: { props: { accessibilityLabel?: unknown } }) =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith('Daily pulse'),
    )[0];
    const label: string = node.props.accessibilityLabel;
    expect(label).toContain('Blood pressure 128/82');
    expect(label).toContain('Heart rate 64 bpm');
    expect(label).toContain('Oxygen 98 %');
    expect(label).toContain('Sleep 7:42 hrs');
    expect(label).toContain('Activity 4,166 steps');
  });
});

// Sprint 19 (audit P1-5) — the hero carried label/value/sub/live but no
// status, so the single biggest number in the app arrived with no
// interpretation while BPDetail, two taps away, showed the verdict for
// the same reading. The copy must come from the shared
// `vitalRangeCopyForTier` — these assert the exact strings it owns.
describe('DailyPulseHero — the central verdict', () => {
  const withTier = (tier: 'in_pattern' | 'calm_concerned' | 'confirmed_urgent') => ({
    ...FRESH_BP,
    sub: '6:42 am',
    unit: 'mmHg',
    tier,
  });

  it('renders the in-pattern verdict under the value', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={withTier('in_pattern')}
          testID="hero"
        />,
      ),
    );
    expect(screen.getByTestId('hero-bp-verdict')).toBeTruthy();
    expect(screen.getByText('mmHg · within your usual range')).toBeTruthy();
  });

  it('renders the calm-concerned verdict', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={withTier('calm_concerned')}
          testID="hero"
        />,
      ),
    );
    expect(screen.getByText('mmHg · worth a look')).toBeTruthy();
  });

  it('renders the confirmed-urgent verdict', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={withTier('confirmed_urgent')}
          testID="hero"
        />,
      ),
    );
    expect(screen.getByText('mmHg · talk to your doctor today')).toBeTruthy();
  });

  it('falls back to the bare unit rather than guessing when there is no tier', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={{ ...FRESH_BP, sub: '6:42 am', unit: 'mmHg', tier: null }}
          testID="hero"
        />,
      ),
    );
    expect(screen.getByTestId('hero-bp-verdict')).toBeTruthy();
    expect(screen.getByText('mmHg')).toBeTruthy();
  });

  it('renders no verdict line at all without a unit (sleep / empty cascade)', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={{ label: 'Last night', value: '7h 24m', sub: 'last night' }}
          testID="hero"
        />,
      ),
    );
    expect(screen.queryByTestId('hero-bp-verdict')).toBeNull();
  });

  it('reads the verdict to screen readers, on the ring and in the composed label', () => {
    render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={withTier('calm_concerned')}
          parentName="Mum"
          testID="hero"
        />,
      ),
    );
    expect(screen.getByTestId('hero-bp').props.accessibilityLabel).toBe(
      'Blood pressure 128/82, mmHg · worth a look',
    );
    const node = screen.UNSAFE_root.findAll((n: { props: { accessibilityLabel?: unknown } }) =>
      typeof n.props.accessibilityLabel === 'string' &&
      n.props.accessibilityLabel.startsWith('Daily pulse for Mum'),
    )[0];
    expect(node.props.accessibilityLabel).toContain('mmHg · worth a look');
  });
});

describe('DailyPulseHero — colorMode snapshot matrix', () => {
  const colorModes: Array<'dark' | 'light'> = ['dark', 'light'];
  for (const colorMode of colorModes) {
    it(`renders colorMode=${colorMode}`, () => {
      const { toJSON } = render(
        withTheme(
          <DailyPulseHero
            vitals={SAMPLE_VITALS}
            central={FRESH_BP}
            aiNarration="Mum is in pattern."
            parentName="Mum"
            testID="hero"
          />,
          colorMode,
        ),
      );
      expect(toJSON()).toMatchSnapshot();
    });
  }
});

describe('DailyPulseHero — adaptive central value branches (D13 §7.2)', () => {
  it('branch 1 — fresh BP', () => {
    const { toJSON } = render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={FRESH_BP}
          testID="hero"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('branch 2 — HR fallback', () => {
    const { toJSON } = render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={{
            label: 'Resting HR',
            value: '62',
            sub: 'bpm · resting',
          }}
          testID="hero"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('branch 3 — sleep fallback', () => {
    const { toJSON } = render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={{
            label: 'Last night',
            value: '7h 24m',
            sub: 'sleep',
          }}
          testID="hero"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it('branch 4 — nothing', () => {
    const { toJSON } = render(
      withTheme(
        <DailyPulseHero
          vitals={SAMPLE_VITALS}
          central={{
            label: 'No readings yet today',
            value: '—',
          }}
          testID="hero"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});
