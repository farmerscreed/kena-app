import { type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import { CaregiverActionBar } from '../CaregiverActionBar';

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

describe('CaregiverActionBar — render', () => {
  it('renders the count + suffix', () => {
    render(withTheme(<CaregiverActionBar count={3} />));
    expect(screen.getByText('3 · all in your circle')).toBeTruthy();
  });

  it('renders the count for a single person without changing the suffix', () => {
    render(withTheme(<CaregiverActionBar count={1} />));
    expect(screen.getByText('1 · all in your circle')).toBeTruthy();
  });
});

describe('CaregiverActionBar — invite affordance', () => {
  it('hides "+ Connect" by default (canInvite undefined)', () => {
    render(withTheme(<CaregiverActionBar count={3} />));
    expect(screen.queryByText('+ Connect')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect with someone' })).toBeNull();
  });

  it('hides "+ Connect" when canInvite is explicitly false', () => {
    render(withTheme(<CaregiverActionBar count={3} canInvite={false} />));
    expect(screen.queryByText('+ Connect')).toBeNull();
  });

  it('shows "+ Connect" when canInvite={true}', () => {
    render(
      withTheme(
        <CaregiverActionBar count={3} canInvite onInvitePress={() => undefined} />,
      ),
    );
    expect(screen.getByText('+ Connect')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Connect with someone' });
    expect(button).toBeTruthy();
  });

  it('fires onInvitePress when the affordance is pressed', () => {
    const onInvitePress = jest.fn();
    render(
      withTheme(
        <CaregiverActionBar
          count={3}
          canInvite
          onInvitePress={onInvitePress}
        />,
      ),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Connect with someone' }));
    expect(onInvitePress).toHaveBeenCalledTimes(1);
  });
});

describe('CaregiverActionBar — accessibility', () => {
  it('does not set an accessibilityRole on the bar root', () => {
    render(
      withTheme(<CaregiverActionBar count={3} testID="action-bar" />),
    );
    const root = screen.getByTestId('action-bar');
    expect(root.props.accessibilityRole).toBeUndefined();
  });

  it('only the invite button is interactive — count is a Text element, not a button', () => {
    render(
      withTheme(
        <CaregiverActionBar count={3} canInvite onInvitePress={() => undefined} />,
      ),
    );
    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityLabel).toBe('Connect with someone');
  });
});

describe('CaregiverActionBar — canInvite × colorMode snapshot matrix', () => {
  const matrix: Array<{ canInvite: boolean; colorMode: 'dark' | 'light' }> = [
    { canInvite: false, colorMode: 'dark' },
    { canInvite: false, colorMode: 'light' },
    { canInvite: true, colorMode: 'dark' },
    { canInvite: true, colorMode: 'light' },
  ];

  for (const { canInvite, colorMode } of matrix) {
    it(`renders canInvite=${canInvite} colorMode=${colorMode}`, () => {
      const { toJSON } = render(
        withTheme(
          <CaregiverActionBar
            count={3}
            canInvite={canInvite}
            onInvitePress={canInvite ? () => undefined : undefined}
            testID="action-bar"
          />,
          colorMode,
        ),
      );
      expect(toJSON()).toMatchSnapshot();
    });
  }
});
