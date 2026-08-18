// SleepHypnogram tests — Sprint 8.5.
//
// Covers:
//   - The pure helper `binTransitionsToBands` (empty / single / multi).
//   - The component renders the AWAKE/REM/LIGHT/DEEP stage labels.
//   - The component renders 30 bins (default) and respects `binCount`.

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  SleepHypnogram,
  binTransitionsToBands,
} from '../SleepHypnogram';
import type { SleepSession, SleepTransition } from '../../types/vitals';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

function makeSession(transitions: SleepTransition[]): SleepSession {
  // 8h session: 11pm → 7am (UTC-relative, but the component formats per
  // locale — the test only asserts presence of structural elements, not
  // exact clock formatting).
  const startSec = Math.floor(new Date('2026-05-07T23:00:00Z').getTime() / 1000);
  const endSec = startSec + 8 * 3600;
  return {
    sessionStartSec: startSec,
    sessionEndSec: endSec,
    sessionStartLocal: new Date(startSec * 1000).toISOString(),
    sessionEndLocal: new Date(endSec * 1000).toISOString(),
    totalMinutes: 480,
    deepMinutes: 98,
    remMinutes: 114,
    lightMinutes: 250,
    awakeMinutes: 18,
    awakeCount: 2,
    transitions,
    sleepScore: 78,
  };
}

describe('binTransitionsToBands — pure helper', () => {
  const start = 1_700_000_000;
  const end = start + 8 * 3600;

  it('returns all "light" bins when transitions is empty', () => {
    const bands = binTransitionsToBands([], start, end, 30);
    expect(bands).toHaveLength(30);
    expect(bands.every((b) => b === 'light')).toBe(true);
  });

  it('honours binCount override', () => {
    const bands = binTransitionsToBands([], start, end, 12);
    expect(bands).toHaveLength(12);
  });

  it('returns all "deep" when a single deep transition spans the session', () => {
    const bands = binTransitionsToBands(
      [{ atSec: start, stage: 'deep' }],
      start,
      end,
      30,
    );
    expect(bands).toHaveLength(30);
    expect(bands.every((b) => b === 'deep')).toBe(true);
  });

  it('picks the dominant stage per bin across multiple transitions', () => {
    // 8h session, three quarters: deep (0..3h), rem (3..5h), light (5..8h)
    const bands = binTransitionsToBands(
      [
        { atSec: start, stage: 'deep' },
        { atSec: start + 3 * 3600, stage: 'rem' },
        { atSec: start + 5 * 3600, stage: 'light' },
      ],
      start,
      end,
      8,
    );
    expect(bands).toHaveLength(8);
    // First 3 bins (each 1h wide) → deep
    expect(bands.slice(0, 3)).toEqual(['deep', 'deep', 'deep']);
    // Bins 3-4 → rem
    expect(bands.slice(3, 5)).toEqual(['rem', 'rem']);
    // Bins 5-7 → light
    expect(bands.slice(5, 8)).toEqual(['light', 'light', 'light']);
  });

  it('falls back to all "light" for an inverted session window', () => {
    const bands = binTransitionsToBands(
      [{ atSec: start, stage: 'deep' }],
      end,
      start,
      10,
    );
    expect(bands.every((b) => b === 'light')).toBe(true);
  });
});

describe('SleepHypnogram — render', () => {
  it('renders the AWAKE / REM / LIGHT / DEEP stage labels', () => {
    render(
      withTheme(
        <SleepHypnogram
          session={makeSession([])}
          testID="hypno"
        />,
      ),
    );
    expect(screen.getByTestId('hypno-label-awake')).toBeTruthy();
    expect(screen.getByTestId('hypno-label-rem')).toBeTruthy();
    expect(screen.getByTestId('hypno-label-light')).toBeTruthy();
    expect(screen.getByTestId('hypno-label-deep')).toBeTruthy();
    expect(screen.getByText('AWAKE')).toBeTruthy();
    expect(screen.getByText('DEEP')).toBeTruthy();
  });

  it('renders 30 bins by default', () => {
    render(
      withTheme(
        <SleepHypnogram
          session={makeSession([])}
          testID="hypno"
        />,
      ),
    );
    for (let i = 0; i < 30; i++) {
      expect(screen.getByTestId(`hypno-bin-${i}`)).toBeTruthy();
    }
    // Out-of-range bin should not exist
    expect(screen.queryByTestId('hypno-bin-30')).toBeNull();
  });

  it('respects an override binCount', () => {
    render(
      withTheme(
        <SleepHypnogram
          session={makeSession([])}
          binCount={10}
          testID="hypno"
        />,
      ),
    );
    expect(screen.getByTestId('hypno-bin-9')).toBeTruthy();
    expect(screen.queryByTestId('hypno-bin-10')).toBeNull();
  });
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// The composed label sat on a View with accessibilityRole="image" but no
// `accessible` prop, so iOS was not guaranteed to expose it.

describe('SleepHypnogram — accessibility (audit P1-6)', () => {
  it('marks the labelled card explicitly accessible', () => {
    render(withTheme(<SleepHypnogram session={makeSession([])} testID="hypno" />));
    const card = screen.getByLabelText(/Sleep stages from/);
    expect(card.props.accessible).toBe(true);
    expect(card.props.accessibilityRole).toBe('image');
  });
});
