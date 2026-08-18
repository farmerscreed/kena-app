import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  composeCorrelationAccessibilityLabel,
  CorrelationStrip,
  polylinePoints,
  scaleX,
  scaleY,
  type VitalSeries,
} from '../CorrelationStrip';

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

// Canonical fixture used across smoke + snapshot tests.
// "Sleep × Morning BP" — sleep = vitalA (solid), bp = vitalB (dashed).
const sleepPoints: VitalSeries = {
  type: 'sleep',
  points: [
    { t: 0, value: 6.5 },
    { t: 1, value: 7.0 },
    { t: 2, value: 7.8 },
    { t: 3, value: 6.2 },
    { t: 4, value: 7.4 },
    { t: 5, value: 8.1 },
    { t: 6, value: 7.5 },
  ],
};
const bpPoints: VitalSeries = {
  type: 'bp',
  points: [
    { t: 0, value: 128 },
    { t: 1, value: 124 },
    { t: 2, value: 121 },
    { t: 3, value: 132 },
    { t: 4, value: 126 },
    { t: 5, value: 119 },
    { t: 6, value: 122 },
  ],
};

// Audit P1-6 — the SVG plot and the bar body are now marked
// decorative (accessibilityElementsHidden /
// importantForAccessibility="no-hide-descendants") because the
// container carries one composed accessibilityLabel instead. RNTL
// excludes inaccessible nodes by default, so structural assertions
// about what is drawn have to opt back in.
const INCLUDE_HIDDEN = { includeHiddenElements: true } as const;

describe('CorrelationStrip — pure logic: scaleX', () => {
  it('maps tMin to the left padded edge', () => {
    expect(scaleX(0, 0, 10, 320)).toBe(4);
  });

  it('maps tMax to the right padded edge', () => {
    expect(scaleX(10, 0, 10, 320)).toBe(316);
  });

  it('maps the midpoint to horizontal centre', () => {
    expect(scaleX(5, 0, 10, 320)).toBe(160);
  });

  it('pins to horizontal centre when range is zero', () => {
    expect(scaleX(7, 7, 7, 320)).toBe(160);
  });
});

describe('CorrelationStrip — pure logic: scaleY', () => {
  it('maps vMax to the top padded edge (inverted axis)', () => {
    expect(scaleY(100, 0, 100, 96)).toBe(4);
  });

  it('maps vMin to the bottom padded edge', () => {
    expect(scaleY(0, 0, 100, 96)).toBe(92);
  });

  it('maps the midpoint to vertical centre', () => {
    expect(scaleY(50, 0, 100, 96)).toBe(48);
  });

  it('pins to vertical centre when range is zero', () => {
    expect(scaleY(50, 50, 50, 96)).toBe(48);
  });
});

describe('CorrelationStrip — pure logic: polylinePoints', () => {
  it('returns empty string for an empty series', () => {
    expect(
      polylinePoints(
        { type: 'bp', points: [] },
        { tMin: 0, tMax: 1, width: 320, height: 96 },
      ),
    ).toBe('');
  });

  it('formats two-point series correctly', () => {
    const series: VitalSeries = {
      type: 'hr',
      points: [
        { t: 0, value: 60 },
        { t: 1, value: 80 },
      ],
    };
    const out = polylinePoints(series, { tMin: 0, tMax: 1, width: 320, height: 96 });
    // x0 = scaleX(0,0,1,320) = 4; y(60) at vMin = 92; x1 = 316; y(80) at vMax = 4.
    expect(out).toBe('4,92 316,4');
  });

  it('handles a single point by emitting one coord pair', () => {
    const series: VitalSeries = {
      type: 'spo2',
      points: [{ t: 5, value: 97 }],
    };
    // Single-point series: zero range on both axes → centred coordinates.
    expect(
      polylinePoints(series, { tMin: 5, tMax: 5, width: 320, height: 96 }),
    ).toBe('160,48');
  });
});

describe('CorrelationStrip — empty series', () => {
  it('renders without crash when vitalA is empty; vitalB still renders', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={{ type: 'sleep', points: [] }}
          vitalB={bpPoints}
          range="7d"
          testID="strip"
        />,
      ),
    );
    expect(screen.getByTestId('strip')).toBeTruthy();
    expect(screen.getByTestId('strip-line-b', INCLUDE_HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('strip-line-a', INCLUDE_HIDDEN)).toBeNull();
  });

  it('renders without crash when both series are empty', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={{ type: 'sleep', points: [] }}
          vitalB={{ type: 'bp', points: [] }}
          range="7d"
          testID="strip"
        />,
      ),
    );
    expect(screen.getByTestId('strip')).toBeTruthy();
    expect(screen.queryByTestId('strip-line-a', INCLUDE_HIDDEN)).toBeNull();
    expect(screen.queryByTestId('strip-line-b', INCLUDE_HIDDEN)).toBeNull();
  });
});

describe('CorrelationStrip — caption', () => {
  it('renders the caption when provided', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={sleepPoints}
          vitalB={bpPoints}
          range="7d"
          caption="Sleep × Morning BP"
          testID="strip"
        />,
      ),
    );
    expect(screen.getByText('Sleep × Morning BP')).toBeTruthy();
  });

  it('does not render a caption when undefined', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={sleepPoints}
          vitalB={bpPoints}
          range="7d"
          testID="strip"
        />,
      ),
    );
    expect(screen.queryByTestId('strip-caption')).toBeNull();
  });
});

describe('CorrelationStrip — smoke render: Sleep × Morning BP', () => {
  it('renders the canonical pair at range=7d', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={sleepPoints}
          vitalB={bpPoints}
          range="7d"
          caption="Sleep × Morning BP"
          testID="strip"
        />,
      ),
    );
    expect(screen.getByTestId('strip')).toBeTruthy();
    expect(screen.getByTestId('strip-line-a', INCLUDE_HIDDEN)).toBeTruthy();
    expect(screen.getByTestId('strip-line-b', INCLUDE_HIDDEN)).toBeTruthy();
  });
});

describe('CorrelationStrip — colorMode snapshot matrix', () => {
  // 1 range × 2 colorModes = 2 snapshots. The visual difference is colorMode,
  // not range — range is data, not chart shape.
  const modes: Array<'dark' | 'light'> = ['dark', 'light'];

  for (const mode of modes) {
    it(`renders range=7d colorMode=${mode}`, () => {
      const { toJSON } = render(
        withTheme(
          <CorrelationStrip
            vitalA={sleepPoints}
            vitalB={bpPoints}
            range="7d"
            caption="Sleep × Morning BP"
            testID="strip"
          />,
          mode,
        ),
      );
      expect(toJSON()).toMatchSnapshot();
    });
  }
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// The strip had zero accessibility props: a screen reader landed on it
// and heard the caption alone, with no idea what was plotted.

describe('CorrelationStrip — accessibility (audit P1-6)', () => {
  it('names both series, their shapes, their counts and their spans', () => {
    const label = composeCorrelationAccessibilityLabel(
      sleepPoints,
      bpPoints,
      '7d',
      'Sleep × Morning BP',
    );
    expect(label).toContain('Sleep × Morning BP.');
    expect(label).toContain('the last 7 days');
    expect(label).toContain('sleep, solid line, 7 points, from 6.2 to 8.1.');
    expect(label).toContain('blood pressure, dashed line, 7 points, from 119 to 132.');
  });

  it('falls back to a neutral opener when there is no caption', () => {
    const label = composeCorrelationAccessibilityLabel(sleepPoints, bpPoints, '30d');
    expect(label).toContain('Two vitals compared.');
    expect(label).toContain('the last 30 days');
  });

  it('describes an absent series calmly rather than claiming a relationship', () => {
    const label = composeCorrelationAccessibilityLabel(
      { type: 'sleep', points: [] },
      bpPoints,
      '90d',
    );
    expect(label).toContain('No sleep to show for this window (solid line).');
    // Descriptive only — we never assert one vital caused the other.
    expect(label.toLowerCase()).not.toContain('because');
    expect(label.toLowerCase()).not.toContain('causes');
  });

  it('handles a flat series without a nonsensical "from X to X"', () => {
    const label = composeCorrelationAccessibilityLabel(
      { type: 'hr', points: [{ t: 0, value: 68 }, { t: 1, value: 68 }] },
      bpPoints,
      '7d',
    );
    expect(label).toContain('heart rate, solid line, 2 points, steady at 68.');
  });

  it('exposes the composed label on an explicitly accessible root', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={sleepPoints}
          vitalB={bpPoints}
          range="7d"
          caption="Sleep × Morning BP"
          testID="strip"
        />,
      ),
    );
    const root = screen.getByTestId('strip');
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityRole).toBe('image');
    expect(root.props.accessibilityLabel).toBe(
      composeCorrelationAccessibilityLabel(sleepPoints, bpPoints, '7d', 'Sleep × Morning BP'),
    );
  });

  it('hides the decorative SVG beneath the composed label', () => {
    render(
      withTheme(
        <CorrelationStrip
          vitalA={sleepPoints}
          vitalB={bpPoints}
          range="7d"
          testID="strip"
        />,
      ),
    );
    const svg = screen.getByTestId('strip-svg', INCLUDE_HIDDEN);
    expect(svg.props.accessibilityElementsHidden).toBe(true);
    expect(svg.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
