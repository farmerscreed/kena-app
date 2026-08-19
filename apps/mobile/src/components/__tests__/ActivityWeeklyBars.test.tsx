// ActivityWeeklyBars — Sprint 8.5.

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  ActivityWeeklyBars,
  barHeightRatio,
  composeActivityWeeklyAccessibilityLabel,
  goalLineFraction,
} from '../ActivityWeeklyBars';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

// Audit P1-6 — the SVG plot and the bar body are now marked
// decorative (accessibilityElementsHidden /
// importantForAccessibility="no-hide-descendants") because the
// container carries one composed accessibilityLabel instead. RNTL
// excludes inaccessible nodes by default, so structural assertions
// about what is drawn have to opt back in.
const INCLUDE_HIDDEN = { includeHiddenElements: true } as const;

describe('barHeightRatio + goalLineFraction — pure helpers', () => {
  it('barHeightRatio scales against max(goal*1.5, valuesMax)', () => {
    const values = [4200, 6800, 7900, 5400, 8200, 9100, 2140];
    const goal = 8000;
    // scaleMax = max(12000, 9100) = 12000
    expect(barHeightRatio(0, values, goal)).toBe(0);
    expect(barHeightRatio(12000, values, goal)).toBe(1);
    expect(barHeightRatio(6000, values, goal)).toBeCloseTo(0.5);
    expect(barHeightRatio(15000, values, goal)).toBe(1); // clamps
  });

  it('goalLineFraction returns 1 - goal/scaleMax (top = 0)', () => {
    const values = [4200, 6800, 7900, 5400, 8200, 9100, 2140];
    expect(goalLineFraction(8000, values)).toBeCloseTo(1 - 8000 / 12000);
  });

  it('handles zero-goal gracefully', () => {
    expect(barHeightRatio(0, [], 0)).toBe(0);
    expect(goalLineFraction(0, [])).toBeGreaterThanOrEqual(0);
  });
});

describe('ActivityWeeklyBars — render', () => {
  const days = [4200, 6800, 7900, 5400, 8200, 9100, 2140];
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  it('renders 7 bars + the goal line + the goal label', () => {
    render(
      withTheme(
        <ActivityWeeklyBars
          days={days}
          dayLabels={labels}
          goal={8000}
          testID="weekly"
        />,
      ),
    );
    for (let i = 0; i < 7; i++) {
      expect(screen.getByTestId(`weekly-bar-${i}`, INCLUDE_HIDDEN)).toBeTruthy();
    }
    expect(screen.getByTestId('activity-weekly-bars-goal-line', INCLUDE_HIDDEN)).toBeTruthy();
    expect(screen.getByText('goal 8k', INCLUDE_HIDDEN)).toBeTruthy();
  });

  it('renders the section eyebrow "This week vs goal"', () => {
    render(
      withTheme(
        <ActivityWeeklyBars
          days={days}
          dayLabels={labels}
          goal={8000}
          testID="weekly"
        />,
      ),
    );
    expect(screen.getByText('This week vs goal')).toBeTruthy();
  });

  it('matches snapshot in dark mode', () => {
    const { toJSON } = render(
      withTheme(
        <ActivityWeeklyBars
          days={days}
          dayLabels={labels}
          goal={8000}
          testID="weekly"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// The chart had zero accessibility props: a screen-reader user heard the
// seven day initials and "goal 8k", with nothing tying them together.

describe('ActivityWeeklyBars — accessibility (audit P1-6)', () => {
  const days = [4200, 6800, 7900, 5400, 8200, 9100, 2140];
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  it('reports the count, the span and how many days met the goal', () => {
    const label = composeActivityWeeklyAccessibilityLabel(days, 8000, 'This week vs goal');
    expect(label).toContain('This week vs goal.');
    expect(label).toContain('7 days shown');
    expect(label).toContain('Steps ranged from 2,140 to 9,100.');
    expect(label).toContain('2 of them reached the goal of 8,000 steps.');
  });

  it('states plainly when no day reached the goal, without scolding', () => {
    const label = composeActivityWeeklyAccessibilityLabel([100, 200], 8000, 'This week vs goal');
    expect(label).toContain('No day reached the goal of 8,000 steps.');
    expect(label.toLowerCase()).not.toContain('failed');
    expect(label.toLowerCase()).not.toContain('should');
  });

  it('states plainly when every day reached the goal, without praising', () => {
    const label = composeActivityWeeklyAccessibilityLabel([9000, 9500], 8000, 'This week vs goal');
    expect(label).toContain('Every one reached the goal of 8,000 steps.');
  });

  it('has calm copy for a week with no data yet', () => {
    const label = composeActivityWeeklyAccessibilityLabel([], 8000, 'This week vs goal');
    expect(label).toContain('Steps appear here once the watch has a day of activity to show.');
  });

  it('exposes the composed label on an explicitly accessible root', () => {
    render(
      withTheme(
        <ActivityWeeklyBars
          days={days}
          dayLabels={labels}
          goal={8000}
          testID="weekly"
        />,
      ),
    );
    const root = screen.getByTestId('weekly');
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityRole).toBe('image');
    expect(root.props.accessibilityLabel).toBe(
      composeActivityWeeklyAccessibilityLabel(days, 8000, 'This week vs goal'),
    );
  });

  it('hides the bars, goal line and day initials beneath the composed label', () => {
    render(
      withTheme(
        <ActivityWeeklyBars
          days={days}
          dayLabels={labels}
          goal={8000}
          testID="weekly"
        />,
      ),
    );
    // The day initials no longer surface as standalone a11y nodes.
    expect(screen.queryByText('goal 8k')).toBeNull();
    expect(screen.getByText('goal 8k', INCLUDE_HIDDEN)).toBeTruthy();
    // The section eyebrow is still readable — it is real copy, not decoration.
    expect(screen.getByText('This week vs goal')).toBeTruthy();
  });
});
