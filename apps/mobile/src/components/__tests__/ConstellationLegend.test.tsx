import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  ConstellationLegend,
  type LegendPerson,
} from '../ConstellationLegend';

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

// Voice-rule-clean fixture: headlines lead with the answer in plain
// language; no "patient", no fear language, no diagnosis claims.
const PEOPLE: LegendPerson[] = [
  {
    id: 'marian',
    fullName: 'Marian Okeke',
    relation: 'Mom',
    accent: '#FF7350',
    status: 'clear',
    headline: 'A calm morning.',
  },
  {
    id: 'emeka',
    fullName: 'Emeka Okeke',
    relation: 'Dad',
    accent: '#F2A618',
    status: 'attention',
    headline: 'BP is trending up.',
  },
  {
    id: 'joy',
    fullName: 'Joy Adeyemi',
    relation: 'Aunt',
    accent: '#7B67CC',
    status: 'sleeping',
    headline: 'Resting since 11pm.',
  },
];

describe('ConstellationLegend — render', () => {
  it('renders one row per person with first name, relation, headline, and a StatusPill', () => {
    render(withTheme(<ConstellationLegend people={PEOPLE} testID="legend" />));

    // First names visible (relation rendered separately as " · {relation}").
    expect(screen.getByText('Marian')).toBeTruthy();
    expect(screen.getByText('Emeka')).toBeTruthy();
    expect(screen.getByText('Joy')).toBeTruthy();

    // " · {relation}" mono uppercase labels.
    expect(screen.getByText('· Mom')).toBeTruthy();
    expect(screen.getByText('· Dad')).toBeTruthy();
    expect(screen.getByText('· Aunt')).toBeTruthy();

    // Headlines.
    expect(screen.getByText('A calm morning.')).toBeTruthy();
    expect(screen.getByText('BP is trending up.')).toBeTruthy();
    expect(screen.getByText('Resting since 11pm.')).toBeTruthy();

    // Three StatusPills (text content from STATUS_LABEL_FOR).
    expect(screen.getByText('In their usual range')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('Sleeping')).toBeTruthy();
  });

  it('takes the first token of fullName as the displayed name', () => {
    render(withTheme(<ConstellationLegend people={PEOPLE} />));
    expect(screen.queryByText('Marian Okeke')).toBeNull();
    expect(screen.queryByText('Emeka Okeke')).toBeNull();
  });
});

describe('ConstellationLegend — sleeping dot has no glow', () => {
  // Helper: flatten a possibly-array RN style prop into a single object.
  const flattenStyle = (s: unknown): Record<string, unknown> => {
    if (!s) return {};
    if (Array.isArray(s)) return Object.assign({}, ...s.map(flattenStyle));
    if (typeof s === 'object') return s as Record<string, unknown>;
    return {};
  };

  // Walk a ReactTestInstance subtree, returning the first descendant
  // whose flattened style.backgroundColor matches `bg`.
  type AnyTestInstance = {
    props?: { style?: unknown };
    children?: Array<AnyTestInstance | string>;
  };
  const findDot = (
    node: AnyTestInstance | string | undefined,
    bg: string,
  ): Record<string, unknown> | null => {
    if (!node || typeof node === 'string') return null;
    const style = flattenStyle(node.props?.style);
    if (style.backgroundColor === bg) return style;
    const children = node.children ?? [];
    for (const c of children) {
      const hit = findDot(c, bg);
      if (hit) return hit;
    }
    return null;
  };

  it('renders the sleeping accent dot with no shadow + 0.5 opacity', () => {
    const onlySleeping: LegendPerson[] = [
      {
        id: 'joy',
        fullName: 'Joy Adeyemi',
        relation: 'Aunt',
        accent: '#7B67CC',
        status: 'sleeping',
        headline: 'Resting since 11pm.',
      },
    ];
    render(
      withTheme(<ConstellationLegend people={onlySleeping} testID="legend" />),
    );

    const row = screen.getByTestId('legend-row-joy') as unknown as AnyTestInstance;
    const dotStyle = findDot(row, '#7B67CC');

    expect(dotStyle).toBeTruthy();
    expect(dotStyle?.opacity).toBe(0.5);
    // No shadow at all on sleeping dots.
    expect(dotStyle?.shadowColor).toBeUndefined();
    expect(dotStyle?.shadowOpacity).toBeUndefined();
    expect(dotStyle?.shadowRadius).toBeUndefined();
  });

  it('non-sleeping accent dot carries an accent-coloured shadow at full opacity', () => {
    const onlyClear: LegendPerson[] = [
      {
        id: 'marian',
        fullName: 'Marian Okeke',
        relation: 'Mom',
        accent: '#FF7350',
        status: 'clear',
        headline: 'A calm morning.',
      },
    ];
    render(
      withTheme(<ConstellationLegend people={onlyClear} testID="legend" />),
    );

    const row = screen.getByTestId('legend-row-marian') as unknown as AnyTestInstance;
    const dotStyle = findDot(row, '#FF7350');

    expect(dotStyle).toBeTruthy();
    expect(dotStyle?.opacity).toBe(1);
    expect(dotStyle?.shadowColor).toBe('#FF7350');
    expect(dotStyle?.shadowOpacity).toBeGreaterThan(0);
  });
});

describe('ConstellationLegend — empty list', () => {
  it('renders the card without rows and does not crash on an empty list', () => {
    render(withTheme(<ConstellationLegend people={[]} testID="legend" />));
    const card = screen.getByTestId('legend');
    expect(card).toBeTruthy();
    // No rows — confirm none of the fixture names slipped through.
    expect(screen.queryByText('Marian')).toBeNull();
    expect(screen.queryByText('Emeka')).toBeNull();
    expect(screen.queryByText('Joy')).toBeNull();
  });
});

describe('ConstellationLegend — interaction', () => {
  it('fires onSelectPerson(id) when a row is pressed', () => {
    const onSelectPerson = jest.fn();
    render(
      withTheme(
        <ConstellationLegend
          people={PEOPLE}
          onSelectPerson={onSelectPerson}
          testID="legend"
        />,
      ),
    );

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Emeka, Dad, Needs attention, BP is trending up.',
      }),
    );
    expect(onSelectPerson).toHaveBeenCalledTimes(1);
    expect(onSelectPerson).toHaveBeenCalledWith('emeka');

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Joy, Aunt, Sleeping, Resting since 11pm.',
      }),
    );
    expect(onSelectPerson).toHaveBeenCalledTimes(2);
    expect(onSelectPerson).toHaveBeenLastCalledWith('joy');
  });
});

describe('ConstellationLegend — accessibility', () => {
  it('exposes each row as a button with a composed name+relation+status+headline label', () => {
    render(withTheme(<ConstellationLegend people={PEOPLE} />));

    expect(
      screen.getByRole('button', {
        name: 'Marian, Mom, In their usual range, A calm morning.',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Emeka, Dad, Needs attention, BP is trending up.',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Joy, Aunt, Sleeping, Resting since 11pm.',
      }),
    ).toBeTruthy();
  });
});

describe('ConstellationLegend — colorMode snapshot matrix', () => {
  const modes: Array<'dark' | 'light'> = ['dark', 'light'];

  for (const mode of modes) {
    it(`renders the 3-person fixture in colorMode=${mode}`, () => {
      const { toJSON } = render(
        withTheme(
          <ConstellationLegend people={PEOPLE} testID="legend" />,
          mode,
        ),
      );
      expect(toJSON()).toMatchSnapshot();
    });
  }
});
