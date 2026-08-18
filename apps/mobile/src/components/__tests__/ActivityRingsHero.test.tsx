// ActivityRingsHero — Sprint 8.5.
//
// Verifies:
//   - Three rings render (steps + calories + move via testIDs)
//   - Giant step value formats with comma separators
//   - Percent line reflects fill against target
//   - Empty state shows "—" + the welcome message
//   - Pure helper `activityRingFill` clamps + mirrors the formula

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  ActivityRingsHero,
  activityRingFill,
} from '../ActivityRingsHero';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

describe('activityRingFill — pure helper', () => {
  it('returns 0 when target is 0 or negative', () => {
    expect(activityRingFill(1234, 0)).toBe(0);
    expect(activityRingFill(1234, -1)).toBe(0);
  });

  it('returns clamped fraction in [0, 1]', () => {
    expect(activityRingFill(0, 6000)).toBe(0);
    expect(activityRingFill(3000, 6000)).toBeCloseTo(0.5);
    expect(activityRingFill(6000, 6000)).toBe(1);
    expect(activityRingFill(12000, 6000)).toBe(1);
  });

  it('coerces NaN to 0', () => {
    expect(activityRingFill(NaN, 6000)).toBe(0);
  });
});

describe('ActivityRingsHero — populated state', () => {
  it('renders the three concentric rings', () => {
    render(
      withTheme(
        <ActivityRingsHero
          steps={2140}
          target={8000}
          calories={410}
          moveMinutes={14}
          testID="hero"
        />,
      ),
    );
    expect(screen.getByTestId('hero-ring-steps')).toBeTruthy();
    expect(screen.getByTestId('hero-ring-calories')).toBeTruthy();
    expect(screen.getByTestId('hero-ring-move')).toBeTruthy();
  });

  it('renders the comma-formatted step count + percent of target', () => {
    render(
      withTheme(
        <ActivityRingsHero
          steps={2140}
          target={8000}
          calories={410}
          moveMinutes={14}
          testID="hero"
        />,
      ),
    );
    // "2,140" appears in BOTH the giant hero number and the steps legend.
    expect(screen.getAllByText('2,140').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('steps · 27% of 8,000')).toBeTruthy();
  });

  it('renders the dot legend with steps + calories + move values', () => {
    render(
      withTheme(
        <ActivityRingsHero
          steps={2140}
          target={8000}
          calories={410}
          moveMinutes={14}
          testID="hero"
        />,
      ),
    );
    expect(screen.getByText('Steps')).toBeTruthy();
    expect(screen.getByText('Calories')).toBeTruthy();
    expect(screen.getByText('Move')).toBeTruthy();
    expect(screen.getByText('410')).toBeTruthy();
    expect(screen.getByText('14m')).toBeTruthy();
  });

  it('shows "—" in the legend when calories or move minutes are null', () => {
    render(
      withTheme(
        <ActivityRingsHero
          steps={2140}
          target={8000}
          calories={null}
          moveMinutes={null}
          testID="hero"
        />,
      ),
    );
    // Two legend dashes (calories + move) — ensure both present
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

describe('ActivityRingsHero — empty state', () => {
  it('shows the dash + welcome message and hides the percent line', () => {
    render(
      withTheme(
        <ActivityRingsHero
          steps={0}
          target={6000}
          empty
          emptyMessage="Start moving to see your day fill in."
          testID="hero"
        />,
      ),
    );
    expect(screen.getByTestId('hero-steps')).toBeTruthy();
    expect(screen.queryByTestId('hero-sub')).toBeNull();
    expect(
      screen.getByText('Start moving to see your day fill in.'),
    ).toBeTruthy();
  });
});

describe('ActivityRingsHero — snapshot', () => {
  it('matches snapshot in dark mode', () => {
    const { toJSON } = render(
      withTheme(
        <ActivityRingsHero
          steps={6250}
          target={6000}
          calories={420}
          moveMinutes={28}
          testID="hero"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// A View that carries an accessibilityLabel but not `accessible` is not
// guaranteed to be exposed as a single element on iOS, so the composed
// label was at risk of never being spoken. `accessible` is now explicit.

describe('ActivityRingsHero — accessibility (audit P1-6)', () => {
  it('marks the labelled root explicitly accessible', () => {
    render(
      withTheme(
        <ActivityRingsHero
          steps={2140}
          target={8000}
          calories={410}
          moveMinutes={14}
          testID="hero"
        />,
      ),
    );
    const root = screen.getByTestId('hero');
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityLabel).toBe('Today, 2,140 steps. 27% of 8,000.');
  });
});
