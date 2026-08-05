import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import { VitalTrendChart, buildChartGeometry } from '../VitalTrendChart';

function withTheme(ui: ReactNode) {
  return (
    <ThemeProvider mode="caregiver" colorMode="dark">
      {ui}
    </ThemeProvider>
  );
}

describe('buildChartGeometry — pure logic', () => {
  it('handles an empty data set without exploding', () => {
    const g = buildChartGeometry([], [60, 80], 320, 170);
    expect(g.xs).toEqual([]);
    expect(g.linePath).toBe('');
    expect(g.fillPath).toBe('');
  });

  it('produces a single coord pair for a one-point series', () => {
    const g = buildChartGeometry([72], [60, 80], 320, 170);
    expect(g.xs).toHaveLength(1);
    expect(g.ys).toHaveLength(1);
  });

  it('correctly identifies peak + trough indices', () => {
    const g = buildChartGeometry([60, 72, 92, 64, 88, 56], [60, 90], 320, 170);
    expect(g.peakIdx).toBe(2); // 92
    expect(g.troughIdx).toBe(5); // 56
  });
});

describe('VitalTrendChart — render', () => {
  it('renders the caption + sub-caption when provided', () => {
    render(
      withTheme(
        <VitalTrendChart
          vital="hr"
          data={[60, 72, 78, 88, 76, 70, 64]}
          range={[60, 95]}
          caption="Today · resting HR"
          subCaption="60–95 band"
          peak
          trough
          testID="chart"
        />,
      ),
    );
    expect(screen.getByTestId('chart-caption')).toBeTruthy();
    expect(screen.getByTestId('chart-subCaption')).toBeTruthy();
    expect(screen.getByTestId('chart-svg')).toBeTruthy();
  });

  it('renders with no caption (chart only)', () => {
    const { toJSON } = render(
      withTheme(
        <VitalTrendChart
          vital="spo2"
          data={[97, 96, 95, 94, 95, 96, 97, 98, 98]}
          range={[95, 100]}
          testID="chart"
        />,
      ),
    );
    expect(toJSON()).toMatchSnapshot();
  });
});

// ── Audit P1-6 ───────────────────────────────────────────────────────
// The composed label was on a View with no `accessible` prop, so iOS was
// not guaranteed to expose it at all.

describe('VitalTrendChart — accessibility (audit P1-6)', () => {
  it('marks the labelled root explicitly accessible and gives it an image role', () => {
    render(
      withTheme(
        <VitalTrendChart
          vital="hr"
          data={[60, 72, 78, 88, 76, 70, 64]}
          range={[60, 95]}
          caption="Today · resting HR"
          peak
          trough
          testID="chart"
        />,
      ),
    );
    const root = screen.getByTestId('chart');
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityRole).toBe('image');
    expect(root.props.accessibilityLabel).toBeTruthy();
  });
});
