import { type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Pill, type PillVariant } from '../Pill';
import { ThemeProvider } from '../../theme';

function withTheme(ui: ReactNode, mode: 'caregiver' | 'parent' = 'caregiver') {
  return <ThemeProvider mode={mode}>{ui}</ThemeProvider>;
}

describe('Pill — variants', () => {
  const variants: PillVariant[] = ['neutral', 'info', 'accent', 'urgent', 'success', 'outline'];

  it.each(variants)('renders the %s variant', (variant) => {
    render(withTheme(<Pill variant={variant}>{variant}</Pill>));
    expect(screen.getByText(variant)).toBeTruthy();
  });
});

describe('Pill — accessibility', () => {
  it('exposes role=text for static pills', () => {
    render(withTheme(<Pill>Today</Pill>));
    // The container is explicitly accessible (§9.1) and RNTL also
    // surfaces the inner Text — on device the flattened container is
    // the single element; here we assert at least one exposure.
    expect(screen.getAllByRole('text', { name: 'Today' }).length).toBeGreaterThan(0);
  });

  it('exposes role=button when onPress is provided', () => {
    render(withTheme(<Pill onPress={() => undefined}>Filter</Pill>));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy();
  });

  it('uses an explicit accessibilityLabel when given', () => {
    render(withTheme(<Pill accessibilityLabel="Custom label">Today</Pill>));
    expect(screen.getByLabelText('Custom label')).toBeTruthy();
  });
});

describe('Pill — interaction', () => {
  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    render(withTheme(<Pill onPress={onPress}>Filter</Pill>));
    fireEvent.press(screen.getByRole('button', { name: 'Filter' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    render(withTheme(<Pill onPress={onPress} disabled>Filter</Pill>));
    fireEvent.press(screen.getByRole('button', { name: 'Filter' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('reflects disabled state in accessibilityState', () => {
    render(withTheme(<Pill onPress={() => undefined} disabled>Filter</Pill>));
    const node = screen.getByRole('button', { name: 'Filter' });
    expect(node.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('reflects selected state in accessibilityState', () => {
    render(withTheme(<Pill onPress={() => undefined} selected>Filter</Pill>));
    const node = screen.getByRole('button', { name: 'Filter' });
    expect(node.props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('Pill — parent mode', () => {
  it('renders without crashing under parent mode', () => {
    render(withTheme(<Pill onPress={() => undefined}>Today</Pill>, 'parent'));
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
  });
});
