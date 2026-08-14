// AcceptInviteSheet — Connect Phase A outcome matrix.
//
// Pins the two Phase A contracts:
//   1. The accept call sends the code only — no email (the accept-time
//      email-match gate was dropped 2026-08-14).
//   2. The success copy tells the truth PER OUTCOME. Before Phase A all
//      three outcomes showed "You've joined the circle…", which was
//      false for sharer_follows and pending.

import { type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme';
import { AcceptInviteSheet } from '../AcceptInviteSheet';

const mockAcceptConnect = jest.fn();
jest.mock('../../services/families/manageInvites', () => ({
  acceptConnect: (...args: unknown[]) => mockAcceptConnect(...args),
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

function connectResult(
  outcome: 'accepter_follows' | 'sharer_follows' | 'pending',
  familyId: string | null,
) {
  return { ok: true, familyId, outcome, canFollowBack: false };
}

async function enterCodeAndJoin(code = '482910') {
  fireEvent.changeText(screen.getByTestId('accept-invite-sheet-code-input'), code);
  await act(async () => {
    fireEvent.press(screen.getByTestId('accept-invite-sheet-join'));
  });
}

beforeEach(() => {
  mockAcceptConnect.mockReset();
});

describe('AcceptInviteSheet', () => {
  it('has no email field and submits the code alone', async () => {
    mockAcceptConnect.mockResolvedValue(connectResult('accepter_follows', 'fam-1'));
    render(withProviders(<AcceptInviteSheet visible onDismiss={jest.fn()} />));
    expect(screen.queryByTestId('accept-invite-sheet-email-input')).toBeNull();
    await enterCodeAndJoin();
    await waitFor(() => {
      expect(mockAcceptConnect).toHaveBeenCalledWith({ code: '482910' });
    });
  });

  it('accepter_follows → tells the accepter they joined the circle', async () => {
    mockAcceptConnect.mockResolvedValue(connectResult('accepter_follows', 'fam-1'));
    render(withProviders(<AcceptInviteSheet visible onDismiss={jest.fn()} />));
    await enterCodeAndJoin();
    expect(screen.getByText("You're connected")).toBeTruthy();
    expect(
      screen.getByText(
        "You've joined the circle. Their readings will appear on your home screen.",
      ),
    ).toBeTruthy();
  });

  it('sharer_follows → tells the wearer the inviter now follows THEM', async () => {
    mockAcceptConnect.mockResolvedValue(connectResult('sharer_follows', 'fam-2'));
    render(withProviders(<AcceptInviteSheet visible onDismiss={jest.fn()} />));
    await enterCodeAndJoin();
    expect(
      screen.getByText(
        "You're connected. They can now follow your readings — you choose what they see in Settings.",
      ),
    ).toBeTruthy();
  });

  it('pending → says sharing starts when a watch pairs, not a fake join', async () => {
    mockAcceptConnect.mockResolvedValue(connectResult('pending', null));
    const onSuccess = jest.fn();
    render(withProviders(<AcceptInviteSheet visible onDismiss={jest.fn()} onSuccess={onSuccess} />));
    await enterCodeAndJoin();
    expect(
      screen.getByText(
        "You're connected. Readings will start sharing once one of you pairs a watch.",
      ),
    ).toBeTruthy();
    // Consumers (FamilyWatch onboarding) receive '' for a pending
    // familyId and must treat it as "no circle yet", not an error.
    expect(onSuccess).toHaveBeenCalledWith({ familyId: '', outcome: 'pending' });
  });

  it('surfaces the rate-limit error calmly', async () => {
    mockAcceptConnect.mockRejectedValue(new Error('too_many_attempts'));
    render(withProviders(<AcceptInviteSheet visible onDismiss={jest.fn()} />));
    await enterCodeAndJoin();
    await waitFor(() => {
      expect(screen.getByTestId('accept-invite-sheet-error')).toBeTruthy();
    });
    expect(
      screen.getByText('Too many tries for now. Wait a little while, then try again.'),
    ).toBeTruthy();
  });

  it('keeps the join button disabled until the code has 6 digits', () => {
    render(withProviders(<AcceptInviteSheet visible onDismiss={jest.fn()} />));
    fireEvent.changeText(screen.getByTestId('accept-invite-sheet-code-input'), '123');
    fireEvent.press(screen.getByTestId('accept-invite-sheet-join'));
    expect(mockAcceptConnect).not.toHaveBeenCalled();
  });
});
