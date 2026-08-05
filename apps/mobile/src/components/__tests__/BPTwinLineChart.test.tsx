// BPTwinLineChart — Sprint 8.5 unit + render tests.
//
// Pure-helper tests run without React/SVG; render tests mount under the
// theme provider to exercise the SVG output + the legend.

import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  BPTwinLineChart,
  buildBPTwinGeometry,
  composeBPTwinAccessibilityLabel,
} from '../BPTwinLineChart';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

const SYS = [114, 110, 122, 124, 128, 130, 126, 120];
const DIA = [72, 70, 78, 79, 82, 84, 81, 76];
const HOURS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
const SYS_RANGE: [number, number] = [110, 130];

// Audit P1-6 — the SVG plot and the bar body are now marked
// decorative (accessibilityElementsHidden /
// importantForAccessibility="no-hide-descendants") because the
// container carries one composed accessibilityLabel instead. RNTL
// excludes inaccessible nodes by default, so structural assertions
// about what is drawn have to opt back in.
const INCLUDE_HIDDEN = { includeHiddenElements: true } as const;

describe('buildBPTwinGeometry — pure logic', () => {
  it('returns empty coords for an empty data set', () => {
    const g = buildBPTwinGeometry([], [], SYS_RANGE, 320, 170);
    expect(g.xs).toEqual([]);
    expect(g.sysY).toEqual([]);
    expect(g.diaY).toEqual([]);
    expect(g.rangeRect.w).toBe(0);
  });

  it('returns one centered coord for a single-point series', () => {
    const g = buildBPTwinGeometry([122], [78], SYS_RANGE, 320, 170);
    expect(g.xs).toHaveLength(1);
    expect(g.sysY).toHaveLength(1);
    expect(g.diaY).toHaveLength(1);
  });

  it('produces sysY < diaY for every point (sys is the higher number, drawn higher on the chart)', () => {
    // Higher BP value → smaller y (SVG y axis grows downward).
    const g = buildBPTwinGeometry(SYS, DIA, SYS_RANGE, 320, 170);
    g.sysY.forEach((y, i) => {
      // Sprint 16.5f — y values are now (number | null); fixture has
      // no nulls, so cast for the assertion.
      expect(y).not.toBeNull();
      const dy = g.diaY[i];
      expect(dy).not.toBeNull();
      expect(y as number).toBeLessThan(dy as number);
    });
  });

  it('returns null y for slots with no reading (16.5f honesty)', () => {
    const g = buildBPTwinGeometry(
      [120, null, 122, null],
      [72, null, 76, null],
      SYS_RANGE,
      320,
      170,
    );
    expect(g.sysY[0]).not.toBeNull();
    expect(g.sysY[1]).toBeNull();
    expect(g.diaY[3]).toBeNull();
  });

  it('range rect height is positive when range[1] > range[0]', () => {
    const g = buildBPTwinGeometry(SYS, DIA, SYS_RANGE, 320, 170);
    expect(g.rangeRect.h).toBeGreaterThan(0);
    expect(g.rangeRect.w).toBeGreaterThan(0);
  });

  it('clamps to the shorter of sys / dia when arrays have differing lengths', () => {
    const g = buildBPTwinGeometry([120, 122, 118], [72, 76], SYS_RANGE, 320, 170);
    expect(g.xs).toHaveLength(2);
    expect(g.sysY).toHaveLength(2);
    expect(g.diaY).toHaveLength(2);
  });
});

describe('BPTwinLineChart — render', () => {
  it('renders a sys + dia dot at every hour', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    // 8 hours × 2 series = 16 dots total
    SYS.forEach((_, i) => {
      expect(screen.getByTestId(`chart-sys-dot-${i}`, INCLUDE_HIDDEN)).toBeTruthy();
      expect(screen.getByTestId(`chart-dia-dot-${i}`, INCLUDE_HIDDEN)).toBeTruthy();
    });
  });

  it('renders the range band rect', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    expect(screen.getByTestId('chart-range-band', INCLUDE_HIDDEN)).toBeTruthy();
  });

  it('renders the two-line legend with plain-language labels', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    expect(screen.getByText('Systolic · the first number')).toBeTruthy();
    expect(screen.getByText('Diastolic')).toBeTruthy();
  });

  it('matches snapshot', () => {
    const { toJSON } = render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// Before this fix the chart carried zero accessibility props, and
// systolic vs diastolic was encoded ONLY as alpha of the same hue — a
// WCAG 1.4.1 failure. These tests pin both halves of the fix.

describe('BPTwinLineChart — accessibility (audit P1-6)', () => {
  it('composeBPTwinAccessibilityLabel reports count, both spans, and the day’s movement', () => {
    const label = composeBPTwinAccessibilityLabel(SYS, DIA, HOURS);
    expect(label).toContain('8 readings');
    expect(label).toContain('The first number ranged from 110 to 130');
    expect(label).toContain('the second number from 70 to 84');
    // SYS starts at 114 and ends at 120 → 6 higher.
    expect(label).toContain('finished the day 6 higher than it started');
  });

  it('composeBPTwinAccessibilityLabel calls a flat day steady rather than inventing movement', () => {
    const label = composeBPTwinAccessibilityLabel(
      [120, 122, 118, 121],
      [78, 80, 76, 79],
      HOURS,
    );
    expect(label).toContain('held steady across the day');
  });

  it('composeBPTwinAccessibilityLabel handles a single reading and names its hour', () => {
    const label = composeBPTwinAccessibilityLabel([122], [78], ['9a']);
    expect(label).toContain('One reading at 9a: 122 over 78.');
  });

  it('composeBPTwinAccessibilityLabel skips slots with no reading', () => {
    const label = composeBPTwinAccessibilityLabel(
      [120, null, 130, null],
      [78, null, 84, null],
      HOURS,
    );
    expect(label).toContain('2 readings');
  });

  it('composeBPTwinAccessibilityLabel stays calm and voice-clean when there is no data', () => {
    const label = composeBPTwinAccessibilityLabel([], [], []);
    expect(label).toContain('No readings for this day yet');
    expect(label.toLowerCase()).not.toContain('patient');
    expect(label.toLowerCase()).not.toContain('abnormal');
  });

  it('exposes the composed label on an explicitly accessible root', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    const root = screen.getByTestId('chart');
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityRole).toBe('image');
    expect(root.props.accessibilityLabel).toBe(
      composeBPTwinAccessibilityLabel(SYS, DIA, HOURS),
    );
  });

  it('hides the decorative SVG plot beneath the composed label', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    const svg = screen.getByTestId('chart-svg', INCLUDE_HIDDEN);
    expect(svg.props.accessibilityElementsHidden).toBe(true);
    expect(svg.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('separates diastolic from systolic by SHAPE, not by opacity (WCAG 1.4.1)', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    const sysDot = screen.getByTestId('chart-sys-dot-0', INCLUDE_HIDDEN);
    const diaDot = screen.getByTestId('chart-dia-dot-0', INCLUDE_HIDDEN);
    // Systolic: filled. Diastolic: hollow ring, full opacity.
    // react-native-svg normalises fill="none" to a null paint.
    expect(sysDot.props.fill).toBeTruthy();
    expect(diaDot.props.fill).toBeFalsy();
    expect(diaDot.props.stroke).toBeTruthy();
    expect(diaDot.props.strokeWidth).toBeGreaterThan(0);
    expect(diaDot.props.fillOpacity).toBeUndefined();
  });

  it('mirrors the two marker shapes in the legend', () => {
    render(
      withTheme(
        <BPTwinLineChart
          vital="bp"
          sys={SYS}
          dia={DIA}
          hourLabels={HOURS}
          range={SYS_RANGE}
          testID="chart"
        />,
      ),
    );
    const sysSwatch = screen.getByTestId('chart-legend-sys-swatch', INCLUDE_HIDDEN);
    const diaSwatch = screen.getByTestId('chart-legend-dia-swatch', INCLUDE_HIDDEN);
    const sysStyle = Object.assign({}, ...[sysSwatch.props.style].flat());
    const diaStyle = Object.assign({}, ...[diaSwatch.props.style].flat());
    // Filled swatch vs ring swatch — the legend agrees with the plot.
    expect(sysStyle.backgroundColor).not.toBe('transparent');
    expect(diaStyle.backgroundColor).toBe('transparent');
    expect(diaStyle.borderWidth).toBeGreaterThan(0);
    // The old encoding — same colour, lower alpha — is gone.
    expect(diaStyle.opacity).toBeUndefined();
  });
});
