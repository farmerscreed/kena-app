// SleepStagesBar — Sprint 18 tz + wakeSource regression tests.

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import { SleepStagesBar } from '../SleepStagesBar';
import { useAuth } from '../../state/auth';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

beforeEach(() => {
  useAuth.setState({ profile: null });
});

describe('SleepStagesBar — tz-aware clock', () => {
  // 2026-05-22T05:30:00Z = 06:30 Lagos = 01:30 NYC (UTC-4 DST).
  // Asserting different output for different tz proves we honored
  // the user's chosen tz rather than the device-OS default.
  const wakeSec = Math.floor(new Date('2026-05-22T05:30:00Z').getTime() / 1000);
  const bedSec = wakeSec - 7 * 3600;

  it('formats the wake-time in the explicit tz prop', () => {
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={bedSec}
          sessionEndSec={wakeSec}
          tz="Africa/Lagos"
          wakeSource="hr_inferred"
          testID="bar"
        />,
      ),
    );
    expect(screen.getByText(/6:30/)).toBeTruthy();
  });

  it('formats the wake-time differently in a different tz', () => {
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={bedSec}
          sessionEndSec={wakeSec}
          tz="America/New_York"
          wakeSource="hr_inferred"
          testID="bar"
        />,
      ),
    );
    expect(screen.getByText(/1:30/)).toBeTruthy();
  });

  it('falls back to the profile tz when no tz prop is supplied', () => {
    useAuth.setState({ profile: { timezone: 'Africa/Lagos' } as never });
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={bedSec}
          sessionEndSec={wakeSec}
          wakeSource="hr_inferred"
          testID="bar"
        />,
      ),
    );
    expect(screen.getByText(/6:30/)).toBeTruthy();
  });
});

describe('SleepStagesBar — bed/wake window shows only for confident HR inference', () => {
  const wakeSec = Math.floor(new Date('2026-05-22T05:30:00Z').getTime() / 1000);
  const bedSec = wakeSec - 7 * 3600;

  it('HIDES the bed/wake clock entirely when wakeSource is fallback (never fabricate a time)', () => {
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={bedSec}
          sessionEndSec={wakeSec}
          tz="UTC"
          wakeSource="fallback"
          testID="bar"
        />,
      ),
    );
    // No "In bed"/"Woke" clock, no estimate caption — duration total only.
    expect(screen.queryByText('In bed')).toBeNull();
    expect(screen.queryByText('Woke')).toBeNull();
    expect(screen.queryByTestId('bar-estimate')).toBeNull();
  });

  it('shows the window with an "est. from heart rate" caption when hr_inferred', () => {
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={bedSec}
          sessionEndSec={wakeSec}
          tz="UTC"
          wakeSource="hr_inferred"
          testID="bar"
        />,
      ),
    );
    expect(screen.getByText('In bed')).toBeTruthy();
    expect(screen.getByText('Woke')).toBeTruthy();
    expect(screen.getByText(/est\. from heart rate/i)).toBeTruthy();
  });

  it('HIDES the clock when wakeSource is undefined (legacy rows have no real times)', () => {
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={bedSec}
          sessionEndSec={wakeSec}
          tz="UTC"
          testID="bar"
        />,
      ),
    );
    expect(screen.queryByText('In bed')).toBeNull();
    expect(screen.queryByText('Woke')).toBeNull();
  });
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// Same fix: the stage-split label was on a View with an image role but no
// `accessible` prop.

describe('SleepStagesBar — accessibility (audit P1-6)', () => {
  it('marks the labelled bar explicitly accessible', () => {
    const wake = Math.floor(new Date('2026-05-22T05:30:00Z').getTime() / 1000);
    render(
      withTheme(
        <SleepStagesBar
          totalMinutes={420}
          deepMinutes={90}
          lightMinutes={200}
          sessionStartSec={wake - 7 * 3600}
          sessionEndSec={wake}
          tz="Africa/Lagos"
          wakeSource="hr_inferred"
          testID="bar"
        />,
      ),
    );
    const bar = screen.getByLabelText(/^Deep \d+%, Light \d+%, Other \d+%$/);
    expect(bar.props.accessible).toBe(true);
    expect(bar.props.accessibilityRole).toBe('image');
  });
});
