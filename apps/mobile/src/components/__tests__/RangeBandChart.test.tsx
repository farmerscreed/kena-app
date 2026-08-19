// RangeBandChart — D13 PR-6 done-when: n=1, n=2, n=3, n=8, n=200 each
// render correctly; the band ribbon is present whenever the baseline is
// sufficient; the series differ by shape and dash, never opacity; the
// composed label is present.

import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  RangeBandChart,
  buildRangeBandGeometry,
  densityFor,
  dotPlotCaption,
  labelledIndices,
  type RangeBandPoint,
} from '../RangeBandChart';
import { ThemeProvider } from '../../theme';

const BAND = { low: 118, high: 134 };

function pts(n: number, value = 126): RangeBandPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    value: value + (i % 5),
    secondary: 80 + (i % 3),
    label: `p${i}`,
  }));
}

function mount(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver" colorMode="dark">
        {ui}
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('density adaptation (§6.3)', () => {
  it('n=0 → empty; the screen owns its empty state', () => {
    const tree = mount(<RangeBandChart vital="bp" points={[]} band={BAND} testID="c" />);
    expect(tree.queryByTestId('c', { includeHiddenElements: true })).toBeNull();
  });

  it.each([1, 2])('n=%i → dot plot: no polyline, counted caption', (n) => {
    const tree = mount(<RangeBandChart vital="bp" points={pts(n)} band={BAND} testID="c" />);
    expect(tree.queryByTestId('c-dot-caption', { includeHiddenElements: true })).toBeTruthy();
    const svg = JSON.stringify(tree.toJSON());
    expect(svg).not.toContain('"d":"M'); // no polyline path rendered
    expect(densityFor(n)).toBe('dots');
  });

  it('the dot captions carry no digits (§0.2)', () => {
    expect(dotPlotCaption(1)).toBe('One reading so far.');
    expect(dotPlotCaption(2)).toBe('Two readings so far.');
    expect(dotPlotCaption(1)).not.toMatch(/\d/);
  });

  it('n=3 → polyline with every point labelled', () => {
    expect(densityFor(3)).toBe('labelled');
    expect(labelledIndices(3, [false, false, false])).toEqual([0, 1, 2]);
    const tree = mount(<RangeBandChart vital="bp" points={pts(3)} band={BAND} testID="c" />);
    expect(JSON.stringify(tree.toJSON())).toContain('"d":"M');
  });

  it('n=8 → sparse labels: first, last, and out-of-band only', () => {
    expect(densityFor(8)).toBe('sparse');
    const oob = [false, false, true, false, false, false, false, false];
    expect(labelledIndices(8, oob)).toEqual([0, 2, 7]);
  });

  it('n=200 renders without error and stays sparse', () => {
    const tree = mount(<RangeBandChart vital="bp" points={pts(200)} band={BAND} testID="c" />);
    expect(tree.getByTestId('c', { includeHiddenElements: true })).toBeTruthy();
    expect(labelledIndices(200, new Array(200).fill(false))).toEqual([0, 199]);
  });
});

describe('the band ribbon (§6.3 — the visual form of the promise)', () => {
  it('is present whenever a sufficient band is supplied', () => {
    const tree = mount(<RangeBandChart vital="bp" points={pts(5)} band={BAND} testID="c" />);
    expect(tree.getByTestId('c-band', { includeHiddenElements: true })).toBeTruthy();
  });

  it('never draws with a null band (learning)', () => {
    const tree = mount(<RangeBandChart vital="bp" points={pts(5)} band={null} testID="c" />);
    expect(tree.queryByTestId('c-band', { includeHiddenElements: true })).toBeNull();
  });
});

describe('series differentiation — shape and dash, never opacity (WCAG 1.4.1)', () => {
  it('secondary renders as hollow squares on a dashed line at full opacity', () => {
    const tree = mount(<RangeBandChart vital="bp" points={pts(5)} band={BAND} testID="c" />);
    const square = tree.getByTestId('c-secondary-0', { includeHiddenElements: true });
    expect(square.props.fill).toBeNull(); // hollow — no fill resolved
    const svg = JSON.stringify(tree.toJSON());
    expect(svg).toContain('strokeDasharray'); // dashed secondary polyline
  });

  it('out-of-band points get size + ring, not colour alone', () => {
    const points = [...pts(4), { value: 160, secondary: 80, label: 'x' }];
    const tree = mount(<RangeBandChart vital="bp" points={points} band={BAND} testID="c" />);
    const oob = tree.getByTestId('c-point-oob-4', { includeHiddenElements: true });
    expect(oob.props.r).toBeGreaterThan(3);
    expect(oob.props.strokeWidth).toBeGreaterThan(0);
  });
});

describe('accessibility', () => {
  it('exposes one composed label on an explicitly accessible wrapper', () => {
    const tree = mount(
      <RangeBandChart vital="bp" points={pts(5)} band={BAND} unit="mmHg" caption="Today" testID="c" />,
    );
    const root = tree.getByTestId('c');
    expect(root.props.accessible).toBe(true);
    expect(root.props.accessibilityLabel).toContain('5 readings plotted');
    expect(root.props.accessibilityLabel).toContain('usual band 118 to 134 mmHg');
    expect(root.props.accessibilityLabel).toContain('latest');
  });
});

describe('geometry', () => {
  it('out-of-band detection judges both series against their own bands', () => {
    const g = buildRangeBandGeometry(
      [
        { value: 126, secondary: 80 },
        { value: 140, secondary: 80 },
        { value: 126, secondary: 95 },
      ],
      BAND,
      { low: 74, high: 86 },
      null,
      320,
      180,
    );
    expect(g.outOfBand).toEqual([false, true, true]);
  });

  it('the ribbon rect spans exactly p10..p90 in chart space', () => {
    const g = buildRangeBandGeometry(pts(5), BAND, null, null, 320, 180);
    expect(g.bandRect).not.toBeNull();
    expect(g.bandRect!.y).toBeCloseTo(g.yFor(BAND.high));
    expect(g.bandRect!.h).toBeCloseTo(g.yFor(BAND.low) - g.yFor(BAND.high));
  });
});
