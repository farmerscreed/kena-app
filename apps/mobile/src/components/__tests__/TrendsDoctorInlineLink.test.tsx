import { type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import {
  TrendsDoctorInlineLink,
  trendsDoctorInlineLinkCopy,
} from '../TrendsDoctorInlineLink';
import { ThemeProvider } from '../../theme';
import { lintVoiceText } from '../../services/voice/voiceLint';

function withTheme(ui: ReactNode) {
  return <ThemeProvider mode="caregiver">{ui}</ThemeProvider>;
}

describe('TrendsDoctorInlineLink', () => {
  it("reads 'for your doctor' for self-buyer accounts", () => {
    render(
      withTheme(
        <TrendsDoctorInlineLink
          accountType="self_buyer"
          onPress={() => undefined}
          testID="doc"
        />,
      ),
    );
    expect(screen.getByText('For your doctor')).toBeTruthy();
  });

  it("reads 'for their doctor' for caregivers", () => {
    render(
      withTheme(
        <TrendsDoctorInlineLink
          accountType="caregiver"
          onPress={() => undefined}
          testID="doc"
        />,
      ),
    );
    expect(screen.getByText('For your doctor')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    render(
      withTheme(
        <TrendsDoctorInlineLink
          accountType="self_buyer"
          onPress={onPress}
          testID="doc"
        />,
      ),
    );
    fireEvent.press(screen.getByTestId('doc'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes accessibilityRole="link" with the label', () => {
    render(
      withTheme(
        <TrendsDoctorInlineLink
          accountType="self_buyer"
          onPress={() => undefined}
          testID="doc"
        />,
      ),
    );
    const node = screen.getByTestId('doc');
    expect(node.props.accessibilityRole).toBe('button');
  });

  it('both copy variants pass voice-lint', () => {
    expect(
      lintVoiceText(trendsDoctorInlineLinkCopy('self_buyer')).passes,
    ).toBe(true);
    expect(
      lintVoiceText(trendsDoctorInlineLinkCopy('caregiver')).passes,
    ).toBe(true);
  });
});
