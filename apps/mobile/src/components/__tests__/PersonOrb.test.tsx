import { type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import { PersonOrb } from '../PersonOrb';
import type { Status } from '../StatusPill';

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

const ACCENT_CORAL = '#FF7350';

const STATUSES: Status[] = [
  'clear',
  'watch',
  'attention',
  'urgent',
  'offline',
  'sleeping',
];

describe('PersonOrb — render', () => {
  it('renders the first name + BP label', () => {
    render(
      withTheme(
        <PersonOrb
          initial="M"
          accent={ACCENT_CORAL}
          status="clear"
          fullName="Marian Okeke"
          bpLabel="122/78"
          testID="orb"
        />,
      ),
    );
    expect(screen.getByText('Marian')).toBeTruthy();
    expect(screen.getByText('122/78')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
  });

  it('takes the first token of fullName as the displayed name', () => {
    render(
      withTheme(
        <PersonOrb
          initial="J"
          accent={ACCENT_CORAL}
          status="sleeping"
          fullName="Joy Adeyemi"
          bpLabel="118/74"
          testID="orb"
        />,
      ),
    );
    expect(screen.getByText('Joy')).toBeTruthy();
    expect(screen.queryByText('Joy Adeyemi')).toBeNull();
  });
});

describe('PersonOrb — accessibility', () => {
  it('exposes a button role with the composed label (name, status, BP)', () => {
    render(
      withTheme(
        <PersonOrb
          initial="E"
          accent={ACCENT_CORAL}
          status="urgent"
          fullName="Emeka Okeke"
          bpLabel="138/89"
          testID="orb"
        />,
      ),
    );
    expect(
      screen.getByRole('button', {
        name: 'Emeka, Urgent, blood pressure 138/89',
      }),
    ).toBeTruthy();
  });

  it('respects an explicit accessibilityLabel override', () => {
    render(
      withTheme(
        <PersonOrb
          initial="M"
          accent={ACCENT_CORAL}
          status="clear"
          fullName="Marian Okeke"
          bpLabel="122/78"
          accessibilityLabel="Mum, all clear"
          testID="orb"
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Mum, all clear' })).toBeTruthy();
  });
});

describe('PersonOrb — interaction', () => {
  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    render(
      withTheme(
        <PersonOrb
          initial="M"
          accent={ACCENT_CORAL}
          status="clear"
          fullName="Marian Okeke"
          bpLabel="122/78"
          onPress={onPress}
          testID="orb"
        />,
      ),
    );
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Marian, In their usual range, blood pressure 122/78',
      }),
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('PersonOrb — status × mode snapshot matrix', () => {
  const modes: Array<'dark' | 'light'> = ['dark', 'light'];

  for (const mode of modes) {
    for (const status of STATUSES) {
      it(`renders status=${status} mode=${mode}`, () => {
        const { toJSON } = render(
          withTheme(
            <PersonOrb
              initial="M"
              accent={ACCENT_CORAL}
              status={status}
              fullName="Marian Okeke"
              bpLabel="122/78"
              testID="orb"
            />,
            mode,
          ),
        );
        expect(toJSON()).toMatchSnapshot();
      });
    }
  }
});
