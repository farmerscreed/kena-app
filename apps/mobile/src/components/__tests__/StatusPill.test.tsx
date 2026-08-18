import { type ReactNode } from 'react';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme';
import { StatusPill, type Status } from '../StatusPill';

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

const STATUSES: Status[] = [
  'clear',
  'watch',
  'attention',
  'urgent',
  'offline',
  'sleeping',
];

describe('StatusPill — labels (voice-rule compliant)', () => {
  it.each(STATUSES)('renders the label for status=%s', (status) => {
    render(withTheme(<StatusPill status={status} testID="pill" />));
    expect(screen.getByTestId('pill')).toBeTruthy();
  });

  it("states the person's own range — no all-clear claim, no clinical language", () => {
    render(withTheme(<StatusPill status="clear" />));
    expect(screen.getByText('In their usual range')).toBeTruthy();
  });

  it('uses "Needs attention" — not "Critical"', () => {
    render(withTheme(<StatusPill status="attention" />));
    expect(screen.getByText('Needs attention')).toBeTruthy();
  });

  it('uses "No recent reading" — not "Device dead"', () => {
    render(withTheme(<StatusPill status="offline" />));
    expect(screen.getByText('No recent reading')).toBeTruthy();
  });
});

describe('StatusPill — accessibility', () => {
  it('exposes accessibilityRole=text + the status label', () => {
    render(withTheme(<StatusPill status="urgent" testID="pill" />));
    const node = screen.getByTestId('pill');
    expect(node.props.accessibilityRole).toBe('text');
    expect(node.props.accessibilityLabel).toBe('Urgent');
  });
});

describe('StatusPill — status × mode snapshot matrix', () => {
  const modes: Array<'dark' | 'light'> = ['dark', 'light'];

  for (const mode of modes) {
    for (const status of STATUSES) {
      it(`renders status=${status} mode=${mode}`, () => {
        const { toJSON } = render(
          withTheme(<StatusPill status={status} testID="pill" />, mode),
        );
        expect(toJSON()).toMatchSnapshot();
      });
    }
  }
});
