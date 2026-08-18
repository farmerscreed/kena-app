import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import {
  ConstellationField,
  CONSTELLATION_MAX_ORBS,
  constellationLayout,
  splitForOrbits,
  type ConstellationPerson,
} from '../ConstellationField';

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

const PEOPLE: ConstellationPerson[] = [
  {
    id: 'mom',
    initial: 'M',
    fullName: 'Marian Okeke',
    accent: '#FF7350',
    status: 'clear',
    bpLabel: '122/78',
  },
  {
    id: 'dad',
    initial: 'E',
    fullName: 'Emeka Okeke',
    accent: '#F2A618',
    status: 'attention',
    bpLabel: '138/89',
  },
  {
    id: 'aunt',
    initial: 'J',
    fullName: 'Joy Adeyemi',
    accent: '#7B67CC',
    status: 'sleeping',
    bpLabel: '118/74',
  },
];

describe('ConstellationField — canvas', () => {
  it('renders the field with the centre "You" label', () => {
    render(withTheme(<ConstellationField people={PEOPLE} testID="field" />));
    expect(screen.getByTestId('field')).toBeTruthy();
    expect(screen.getByTestId('field-svg')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });
});

describe('ConstellationField — three-person fixture', () => {
  it('renders each person\'s first name + BP label', () => {
    render(withTheme(<ConstellationField people={PEOPLE} testID="field" />));
    // First name only (PersonOrb splits on the first space).
    expect(screen.getByText('Marian')).toBeTruthy();
    expect(screen.getByText('Emeka')).toBeTruthy();
    expect(screen.getByText('Joy')).toBeTruthy();
    expect(screen.getByText('122/78')).toBeTruthy();
    expect(screen.getByText('138/89')).toBeTruthy();
    expect(screen.getByText('118/74')).toBeTruthy();
  });

  it('mounts one orb wrapper per person', () => {
    render(withTheme(<ConstellationField people={PEOPLE} testID="field" />));
    expect(screen.getByTestId('field-orb-mom')).toBeTruthy();
    expect(screen.getByTestId('field-orb-dad')).toBeTruthy();
    expect(screen.getByTestId('field-orb-aunt')).toBeTruthy();
  });
});

describe('ConstellationField — small circles', () => {
  it('renders nothing-but-the-canvas with an empty people list', () => {
    render(withTheme(<ConstellationField people={[]} testID="field" />));
    expect(screen.getByTestId('field')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByText('Marian')).toBeNull();
  });

  it('renders only the supplied person when one is given', () => {
    render(
      withTheme(
        <ConstellationField people={[PEOPLE[0]]} testID="field" />,
      ),
    );
    expect(screen.getByText('Marian')).toBeTruthy();
    expect(screen.queryByText('Emeka')).toBeNull();
    expect(screen.queryByText('Joy')).toBeNull();
  });

  it('renders only the supplied two when two are given', () => {
    render(
      withTheme(
        <ConstellationField people={[PEOPLE[0], PEOPLE[1]]} testID="field" />,
      ),
    );
    expect(screen.getByText('Marian')).toBeTruthy();
    expect(screen.getByText('Emeka')).toBeTruthy();
    expect(screen.queryByText('Joy')).toBeNull();
  });
});

// Sprint 19 (audit P1-4) — v1 hardcoded three orb slots and dropped
// everyone past index 2 behind a `__DEV__` console.warn, while the legend
// beneath the field kept listing them. These lock in the replacement:
// five people all render, and past that the overflow is VISIBLE.
describe('ConstellationField — beyond three people', () => {
  const extra = (id: string, name: string): ConstellationPerson => ({
    id,
    initial: name[0],
    fullName: name,
    accent: '#FF7350',
    status: 'clear',
    bpLabel: '120/80',
  });

  it('renders a fourth person instead of dropping them', () => {
    render(
      withTheme(
        <ConstellationField
          people={[...PEOPLE, extra('cousin', 'Ada Nwosu')]}
          testID="field"
        />,
      ),
    );
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByTestId('field-orb-cousin')).toBeTruthy();
    expect(screen.queryByTestId('field-overflow')).toBeNull();
  });

  it('renders five people with no overflow marker', () => {
    const five = [
      ...PEOPLE,
      extra('cousin', 'Ada Nwosu'),
      extra('uncle', 'Tunde Bello'),
    ];
    render(withTheme(<ConstellationField people={five} testID="field" />));
    for (const p of five) {
      expect(screen.getByTestId(`field-orb-${p.id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('field-overflow')).toBeNull();
  });

  it('never drops anyone silently — the sixth surfaces as "+2 more"', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const six = [
      ...PEOPLE,
      extra('cousin', 'Ada Nwosu'),
      extra('uncle', 'Tunde Bello'),
      extra('nephew', 'Chidi Eze'),
    ];
    render(withTheme(<ConstellationField people={six} testID="field" />));
    const overflow = screen.getByTestId('field-overflow');
    expect(overflow).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('more')).toBeTruthy();
    expect(overflow.props.accessibilityLabel).toBe(
      '2 more in your circle, listed below',
    );
    // The drop is on screen, not in a dev-only console warning.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// Sprint 19 (audit P1-4) — the pure geometry. v1's 360x360 box left ~290pt
// of dead space around a single orb and overflowed a 320pt viewport.
describe('constellationLayout — data-driven geometry', () => {
  it('collapses the canvas for one person versus five', () => {
    const one = constellationLayout(1, 328, false);
    const five = constellationLayout(5, 328, false);
    expect(one.height).toBeLessThan(five.height);
    expect(one.height).toBeLessThan(360);
  });

  it('shrinks to fit a narrow viewport rather than overflowing it', () => {
    // 320pt phone, minus CaregiverHome's 32pt of gutters.
    const layout = constellationLayout(3, 288, false);
    expect(layout.width).toBeLessThanOrEqual(288);
  });

  it('never grows past the 360pt design width on a large phone', () => {
    expect(constellationLayout(3, 500, false).width).toBe(360);
  });

  it('keeps every orb inside the canvas horizontally', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const layout = constellationLayout(count, 288, false);
      for (const slot of layout.slots) {
        expect(slot.cx - slot.diameter / 2).toBeGreaterThanOrEqual(0);
        expect(slot.cx + slot.diameter / 2).toBeLessThanOrEqual(layout.width);
      }
    }
  });

  it('keeps every orb and its hanging label inside the canvas vertically', () => {
    for (const count of [1, 2, 3, 4, 5]) {
      for (const hasSelf of [false, true]) {
        const layout = constellationLayout(count, 328, hasSelf);
        for (const slot of layout.slots) {
          expect(slot.cy - slot.diameter / 2).toBeGreaterThanOrEqual(0);
          expect(slot.cy + slot.diameter / 2).toBeLessThanOrEqual(layout.height);
        }
      }
    }
  });

  it('spaces orbs evenly around the centre', () => {
    const layout = constellationLayout(5, 328, false);
    const radii = layout.slots.map((s) =>
      Math.hypot(s.cx - layout.cx, s.cy - layout.cy),
    );
    for (const r of radii) expect(r).toBeCloseTo(radii[0], 5);
    const angles = layout.slots.map((s) =>
      Math.atan2(layout.cy - s.cy, s.cx - layout.cx),
    );
    const gaps = angles
      .slice(1)
      .map((a, i) => ((angles[i] - a + Math.PI * 2) % (Math.PI * 2)));
    for (const g of gaps) expect(g).toBeCloseTo((Math.PI * 2) / 5, 5);
  });

  it('draws no orbital rings when nobody is in orbit', () => {
    expect(constellationLayout(0, 328, false).showRings).toBe(false);
    expect(constellationLayout(1, 328, false).showRings).toBe(true);
  });
});

describe('splitForOrbits — the cap is visible, never silent', () => {
  const person = (id: string): ConstellationPerson => ({
    id,
    initial: 'X',
    fullName: `Person ${id}`,
    accent: '#FF7350',
    status: 'clear',
    bpLabel: '120/80',
  });

  it('gives everyone an orb up to the cap', () => {
    for (let n = 0; n <= CONSTELLATION_MAX_ORBS; n += 1) {
      const people = Array.from({ length: n }, (_, i) => person(String(i)));
      const split = splitForOrbits(people);
      expect(split.visible).toHaveLength(n);
      expect(split.overflowCount).toBe(0);
    }
  });

  it('accounts for every person past the cap in the overflow count', () => {
    for (const n of [6, 7, 12]) {
      const people = Array.from({ length: n }, (_, i) => person(String(i)));
      const split = splitForOrbits(people);
      expect(split.visible.length + split.overflowCount).toBe(n);
      expect(split.visible.length + 1).toBe(CONSTELLATION_MAX_ORBS);
    }
  });
});

describe('ConstellationField — interaction', () => {
  it('fires onSelectPerson with the tapped person\'s id', () => {
    const onSelectPerson = jest.fn();
    render(
      withTheme(
        <ConstellationField
          people={PEOPLE}
          onSelectPerson={onSelectPerson}
          testID="field"
        />,
      ),
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Emeka, Needs attention, blood pressure 138/89',
      }),
    );
    expect(onSelectPerson).toHaveBeenCalledTimes(1);
    expect(onSelectPerson).toHaveBeenCalledWith('dad');

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Marian, In their usual range, blood pressure 122/78',
      }),
    );
    expect(onSelectPerson).toHaveBeenCalledTimes(2);
    expect(onSelectPerson).toHaveBeenLastCalledWith('mom');

    fireEvent.press(
      screen.getByRole('button', {
        name: 'Joy, Sleeping, blood pressure 118/74',
      }),
    );
    expect(onSelectPerson).toHaveBeenCalledTimes(3);
    expect(onSelectPerson).toHaveBeenLastCalledWith('aunt');
  });
});

describe('ConstellationField — snapshot per colorMode', () => {
  const modes: Array<'dark' | 'light'> = ['dark', 'light'];
  for (const mode of modes) {
    it(`renders three-person fixture in mode=${mode}`, () => {
      const { toJSON } = render(
        withTheme(
          <ConstellationField people={PEOPLE} testID="field" />,
          mode,
        ),
      );
      expect(toJSON()).toMatchSnapshot();
    });
  }
});
