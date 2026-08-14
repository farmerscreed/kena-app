// ConnectShareSheet — Connect Phase B.
//
// Pins the zero-input contract: opening the sheet mints a code with NO
// required fields (createConnect called with no arguments), the code
// renders for sharing, and generation failure gets a calm retry.

import { type ReactNode } from 'react';
import { Share } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { ConnectShareSheet } from '../ConnectShareSheet';

const mockCreateConnect = jest.fn();
jest.mock('../../services/families/manageInvites', () => ({
  createConnect: (...args: unknown[]) => mockCreateConnect(...args),
}));

function withProviders(ui: ReactNode) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, bottom: 34, left: 0, right: 0 },
      }}
    >
      <ThemeProvider mode="caregiver">{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

let shareSpy: jest.SpyInstance;

beforeEach(() => {
  mockCreateConnect.mockReset();
  shareSpy = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction' } as never);
});

afterEach(() => {
  shareSpy.mockRestore();
});

describe('ConnectShareSheet', () => {
  it('generates a code on open with zero inputs', async () => {
    mockCreateConnect.mockResolvedValue({
      invitationId: 'inv-1',
      pairingCode: '482913',
      expiresAt: '2026-08-21T00:00:00Z',
    });
    render(withProviders(<ConnectShareSheet visible onDismiss={jest.fn()} />));
    await waitFor(() => {
      expect(mockCreateConnect).toHaveBeenCalledWith();
    });
    await waitFor(() => {
      expect(screen.getByTestId('connect-share-code')).toBeTruthy();
    });
    expect(screen.getByText('482913')).toBeTruthy();
  });

  it('shares a code-first message with the /join?code= link', async () => {
    mockCreateConnect.mockResolvedValue({
      invitationId: 'inv-1',
      pairingCode: '482913',
      expiresAt: '2026-08-21T00:00:00Z',
    });
    render(withProviders(<ConnectShareSheet visible onDismiss={jest.fn()} />));
    await waitFor(() => expect(screen.getByTestId('connect-share-code')).toBeTruthy());
    fireEvent.press(screen.getByTestId('connect-share-share'));
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const { message } = shareSpy.mock.calls[0][0] as { message: string };
    expect(message).toContain('https://leiko.app/join?code=482913');
    expect(message).toContain('enter code 482913');
  });

  it('shows a calm error with retry when generation fails, then recovers', async () => {
    mockCreateConnect
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        invitationId: 'inv-2',
        pairingCode: '135791',
        expiresAt: '2026-08-21T00:00:00Z',
      });
    render(withProviders(<ConnectShareSheet visible onDismiss={jest.fn()} />));
    await waitFor(() => {
      expect(screen.getByTestId('connect-share-error')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('connect-share-retry'));
    });
    await waitFor(() => {
      expect(screen.getByText('135791')).toBeTruthy();
    });
  });
});
