// SleepNightlyBars — audit finding P1-6.
//
// Before this fix the bar grid carried `accessibilityRole="image"` with NO
// accessibilityLabel, which is worse than carrying no role: VoiceOver
// announces "image" and then has nothing to say about it. These tests pin
// the composed sentence and the decorative marking underneath it.

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  composeSleepNightlyAccessibilityLabel,
  SleepNightlyBars,
} from '../SleepNightlyBars';
import type { SleepSession } from '../../types/vitals';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

const DAY_SEC = 24 * 60 * 60;

function session(daysAgo: number, totalMinutes: number): SleepSession {
  const endSec = Math.floor(Date.now() / 1000) - daysAgo * DAY_SEC;
  const deep = Math.round(totalMinutes * 0.2);
  const light = Math.round(totalMinutes * 0.55);
  return {
    sessionStartSec: endSec - totalMinutes * 60,
    sessionEndSec: endSec,
    sessionStartLocal: new Date((endSec - totalMinutes * 60) * 1000).toISOString(),
    sessionEndLocal: new Date(endSec * 1000).toISOString(),
    totalMinutes,
    deepMinutes: deep,
    remMinutes: Math.round(totalMinutes * 0.15),
    lightMinutes: light,
    awakeMinutes: Math.max(0, totalMinutes - deep - light),
    awakeCount: 1,
    transitions: [],
    sleepScore: 78,
  };
}

describe('composeSleepNightlyAccessibilityLabel (audit P1-6)', () => {
  it('names the window, the tracked count and the span', () => {
    const label = composeSleepNightlyAccessibilityLabel([340, 460, 400], 7, '7d');
    expect(label).toContain('Nightly sleep across the last 7 nights.');
    expect(label).toContain('3 of 7 nights tracked.');
    expect(label).toContain('From 5 hours 40 minutes to 7 hours 40 minutes.');
  });

  it('avoids a nonsensical "from X to X" for a single tracked night', () => {
    const label = composeSleepNightlyAccessibilityLabel([480], 7, '7d');
    expect(label).toContain('1 of 7 nights tracked.');
    expect(label).toContain('Each was 8 hours.');
  });

  it('reads minutes-only durations without a bare "0 hours"', () => {
    const label = composeSleepNightlyAccessibilityLabel([45], 7, '7d');
    expect(label).toContain('45 minutes');
    expect(label).not.toContain('0 hours');
  });

  it('names the 30d and 90d windows', () => {
    expect(composeSleepNightlyAccessibilityLabel([400], 30, '30d')).toContain(
      'the last 30 nights',
    );
    expect(composeSleepNightlyAccessibilityLabel([400], 90, '90d')).toContain(
      'the last 90 nights',
    );
  });

  it('has calm, voice-clean copy when nothing has been tracked yet', () => {
    const label = composeSleepNightlyAccessibilityLabel([], 7, '7d');
    expect(label).toContain('No nights tracked yet in this window');
    expect(label.toLowerCase()).not.toContain('patient');
    expect(label.toLowerCase()).not.toContain('abnormal');
  });
});

describe('SleepNightlyBars — render (audit P1-6)', () => {
  const sessions = [session(0, 470), session(1, 395), session(3, 512)];

  it('gives the chart frame a real label alongside its image role', () => {
    render(
      withTheme(<SleepNightlyBars sessions={sessions} range="7d" testID="nightly" />),
    );
    const frame = screen.getByLabelText(/Nightly sleep across the last 7 nights/);
    expect(frame.props.accessible).toBe(true);
    expect(frame.props.accessibilityRole).toBe('image');
    expect(frame.props.accessibilityLabel).toContain('3 of 7 nights tracked.');
  });

  it('no longer exposes a labelless image role', () => {
    render(
      withTheme(<SleepNightlyBars sessions={sessions} range="7d" testID="nightly" />),
    );
    const images = screen.UNSAFE_getAllByProps({ accessibilityRole: 'image' });
    for (const node of images) {
      expect(node.props.accessibilityLabel).toBeTruthy();
    }
  });

  it('marks the bar grid decorative beneath the composed label', () => {
    render(
      withTheme(<SleepNightlyBars sessions={sessions} range="7d" testID="nightly" />),
    );
    const bar = screen.getByTestId(`nightly-bar-${dayKeyOf(sessions[0])}`, {
      includeHiddenElements: true,
    });
    expect(bar).toBeTruthy();
    // …and it is hidden from the accessibility tree.
    expect(
      screen.queryByTestId(`nightly-bar-${dayKeyOf(sessions[0])}`),
    ).toBeNull();
  });
});

function dayKeyOf(s: SleepSession): string {
  const d = new Date(s.sessionEndSec * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}
