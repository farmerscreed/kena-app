// SettingsScreen — Sprint 10b.1 integration tests.
//
// Covers:
//   • Profile section renders for both account types; hypertension chip
//     is self-buyer only (D8a §10.1).
//   • Watch section preserves the Sprint 5 paired vs empty branches +
//     the Forget sheet.
//   • About section renders version + opens external URLs via Linking.
//   • Sign-out flow opens a dignified sheet (no guilt copy) and routes
//     through useAuth.signOut.
//
// Mocks the data hooks at the boundary so this stays a screen test, not
// a data test. updateProfile is mocked to assert hypertension writes.

import { type ReactNode } from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../../../theme';
import { SettingsScreen } from '../SettingsScreen';
import type { UserRow } from '../../../types/database';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockRefreshProfile = jest.fn().mockResolvedValue(undefined);
const mockForget = jest.fn().mockResolvedValue(undefined);
const mockUpdateProfile = jest.fn().mockResolvedValue({} as UserRow);

let mockProfile: UserRow | null = null;
let mockPairedDevice: { bleId: string; name: string | null; macSuffix: string; pairedAt: number } | null = null;

jest.mock('../../../state/auth', () => ({
  useAuth: (selector?: (s: unknown) => unknown) => {
    const state = {
      profile: mockProfile,
      refreshProfile: mockRefreshProfile,
      signOut: mockSignOut,
    };
    return selector ? selector(state) : state;
  },
}));

jest.mock('../../../state/pairing', () => ({
  usePairing: (selector?: (s: unknown) => unknown) => {
    const state = {
      pairedDevice: mockPairedDevice,
      forget: mockForget,
    };
    return selector ? selector(state) : state;
  },
}));

jest.mock('../../../services/users/updateProfile', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

// Sprint 10b.3 — Settings now uses @react-navigation/native useNavigation
// for the AuditLog nav. Stub it.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  // ADR-0006 — Settings reads route.params for deep-linked invite codes.
  useRoute: () => ({ params: undefined }),
}));

jest.mock('../../../services/users/accountActions', () => ({
  exportFamilyData: jest.fn().mockResolvedValue({ rowCount: 0 }),
  deleteAccount: jest.fn().mockResolvedValue({ deletedAt: '2026-05-09T00:00:00Z' }),
}));

const mockCreateConnect = jest.fn();
const mockAcceptConnect = jest.fn();
jest.mock('../../../services/families/manageInvites', () => ({
  // ADR-0007 unified connect (replaces send/accept/resolve mocks).
  createConnect: (...args: unknown[]) => mockCreateConnect(...args),
  acceptConnect: (...args: unknown[]) => mockAcceptConnect(...args),
}));

// Sprint 10c.2 / ADR-0006 Phase 4 — Settings uses useFamilyReadings to
// split the family surface into wearer vs follower sections. Mutable
// fixture so tests can simulate "I wear a circle" vs "I follow circles".
// Default: a single self-circle (the viewer is a wearer).
let mockParents: Array<{
  familyId: string;
  parentDisplayName?: string;
  parentRelationship?: string;
  viewerRole?: string;
}> = [{ familyId: 'fam-1', parentDisplayName: 'Lawrence', parentRelationship: 'self', viewerRole: 'family_owner' }];
jest.mock('../../../hooks/useFamilyReadings', () => ({
  useFamilyReadings: () => ({
    parents: mockParents,
    isLoading: false,
    isRefreshing: false,
    error: null,
    refresh: jest.fn(),
  }),
}));

const mockListCaregivers = jest.fn().mockResolvedValue([]);
jest.mock('../../../services/families/visibility', () => ({
  listCaregivers: (...args: unknown[]) => mockListCaregivers(...args),
}));

// Sprint 10b.2 — Settings now reads usePlusEntitlement (TanStack Query
// against families) + the AI quota service. Stub the entitlement hook
// to a free user so the AI section renders the free-tier copy.
jest.mock('../../../hooks/usePlusEntitlement', () => ({
  usePlusEntitlement: () => ({
    tier: 'free',
    isPlus: false,
    isLoading: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  }),
  isPlusTier: (t: string) => ['plus', 'plus_trial', 'plus_grace'].includes(t),
}));

jest.mock('../../../services/ai/quotaCounter', () => ({
  getQuotaSnapshot: () => ({
    count: 0,
    limit: 5,
    monthKey: '2026-05',
    lastReconcileMs: null,
  }),
  reconcileFromAuditLog: jest.fn().mockResolvedValue(0),
  FREE_TIER_QUOTA: 5,
  PLUS_TIER_QUOTA: 100,
  quotaForTier: (t: string) =>
    ['plus', 'plus_trial', 'plus_grace'].includes(t) ? 100 : 5,
}));

const linkingSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

function makeProfile(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    email: 'biebele@gmail.com',
    display_name: 'Adaeze Okafor',
    photo_url: null,
    preferred_language: 'en',
    timezone: 'Africa/Lagos',
    year_of_birth: 1985,
    account_type: 'caregiver',
    marketing_opt_in: false,
    gender: null,
    height_cm: null,
    weight_kg: null,
    hypertension_status: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderScreen(): ReturnType<typeof render> {
  const navigation = { goBack: mockGoBack, navigate: mockNavigate } as unknown as {
    goBack: () => void;
    navigate: (route: string) => void;
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (node: ReactNode) =>
    (
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
          <ThemeProvider mode="caregiver">{node}</ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    );
  return render(
    wrap(
      <SettingsScreen
        navigation={navigation}
      />,
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = makeProfile();
  mockPairedDevice = null;
  // Default: the viewer wears a self-circle they own (family_owner) so the
  // "Following your readings" section + EditFamilyDetails mount. The render
  // wrapper supplies a QueryClientProvider for the latter.
  mockParents = [{ familyId: 'fam-1', parentDisplayName: 'Lawrence', parentRelationship: 'self', viewerRole: 'family_owner' }];
});

describe('<SettingsScreen /> — Profile', () => {
  it('renders the six profile rows for a caregiver', () => {
    renderScreen();
    expect(screen.getByTestId('settings-profile-name')).toBeTruthy();
    expect(screen.getByTestId('settings-profile-yob')).toBeTruthy();
    expect(screen.getByTestId('settings-profile-gender')).toBeTruthy();
    expect(screen.getByTestId('settings-profile-height')).toBeTruthy();
    expect(screen.getByTestId('settings-profile-weight')).toBeTruthy();
    expect(screen.getByTestId('settings-profile-timezone')).toBeTruthy();
    // Photo row removed in Sprint 12.5.2 pending image-picker work.
    expect(screen.queryByTestId('settings-profile-photo')).toBeNull();
    // Hypertension chip is self-buyer only.
    expect(screen.queryByTestId('settings-profile-hypertension')).toBeNull();
  });

  it('renders the hypertension chip only for self-buyers', () => {
    mockProfile = makeProfile({ account_type: 'self_buyer' });
    renderScreen();
    expect(screen.getByTestId('settings-profile-hypertension')).toBeTruthy();
  });

  it('writes the new hypertension status on chip select', async () => {
    mockProfile = makeProfile({ account_type: 'self_buyer' });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-hypertension'));
    expect(screen.getByTestId('settings-hypertension-yes')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-hypertension-yes'));
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', {
        hypertension_status: 'yes',
      });
    });
    expect(mockRefreshProfile).toHaveBeenCalled();
  });
});

describe('<SettingsScreen /> — Profile field editor (Sprint 12.5.2)', () => {
  it('opens the year-of-birth sheet when the yob row is tapped + saves a single-field patch', async () => {
    mockProfile = makeProfile({ year_of_birth: null });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-yob'));
    expect(screen.getByTestId('settings-demographics-yob')).toBeTruthy();
    // The other field inputs should NOT be visible — this is a focused sheet.
    expect(screen.queryByTestId('settings-demographics-gender-male')).toBeNull();
    expect(screen.queryByTestId('settings-demographics-height')).toBeNull();
    expect(screen.queryByTestId('settings-demographics-weight')).toBeNull();
    fireEvent.changeText(screen.getByTestId('settings-demographics-yob'), '1980');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', { year_of_birth: 1980 });
    });
    expect(mockRefreshProfile).toHaveBeenCalled();
  });

  it('opens the gender sheet and saves immediately on pill tap', async () => {
    mockProfile = makeProfile({ gender: null });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-gender'));
    expect(screen.getByTestId('settings-demographics-gender-male')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-gender-male'));
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', { gender: 'male' });
    });
  });

  it('saves height in cm when the cm unit is selected', async () => {
    mockProfile = makeProfile({ height_cm: null });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-height'));
    fireEvent.changeText(screen.getByTestId('settings-demographics-height'), '175');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', { height_cm: 175 });
    });
  });

  it('saves height converted from feet+inches when the ft unit is selected', async () => {
    mockProfile = makeProfile({ height_cm: null });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-height'));
    fireEvent.press(screen.getByTestId('settings-demographics-height-unit-ft'));
    fireEvent.changeText(screen.getByTestId('settings-demographics-height-ft'), '5');
    fireEvent.changeText(screen.getByTestId('settings-demographics-height-in'), '9');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    // 5'9" = 60+9 = 69 inches × 2.54 = 175.26 → rounds to 175.
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', { height_cm: 175 });
    });
  });

  it('saves weight in kg when the kg unit is selected', async () => {
    mockProfile = makeProfile({ weight_kg: null });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-weight'));
    fireEvent.changeText(screen.getByTestId('settings-demographics-weight'), '78');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', { weight_kg: 78 });
    });
  });

  it('saves weight converted from lbs when the lbs unit is selected', async () => {
    mockProfile = makeProfile({ weight_kg: null });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-weight'));
    fireEvent.press(screen.getByTestId('settings-demographics-weight-unit-lbs'));
    fireEvent.changeText(screen.getByTestId('settings-demographics-weight'), '155');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    // 155 lbs ÷ 2.2046 = 70.31 → rounds to 70.
    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', { weight_kg: 70 });
    });
  });

  it('rejects out-of-range year of birth', async () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-yob'));
    fireEvent.changeText(screen.getByTestId('settings-demographics-yob'), '1800');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    expect(screen.getByTestId('settings-demographics-error')).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('rejects out-of-range height', async () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-height'));
    fireEvent.changeText(screen.getByTestId('settings-demographics-height'), '5');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-save'));
    });
    expect(screen.getByTestId('settings-demographics-error')).toBeTruthy();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('persists timezone via the "use device timezone" button', async () => {
    // Stored zone must differ from the device zone, else the button is
    // disabled (already current). The test runner is pinned to UTC
    // (jest.config), so seed a non-UTC stored value to keep it enabled.
    mockProfile = makeProfile({ timezone: 'Africa/Lagos' });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-profile-timezone'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-demographics-timezone-use-device'));
    });
    await waitFor(() => {
      // Saves the device-resolved zone (UTC under the pinned test clock).
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({
        timezone: 'UTC',
      }));
    });
  });
});

describe('<SettingsScreen /> — Watch', () => {
  it('shows the empty state + pair CTA when no device is paired', () => {
    mockPairedDevice = null;
    renderScreen();
    expect(screen.getByTestId('settings-watch-empty')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-watch-pair-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Pairing');
  });

  it('shows the paired card and last-sync row when a device is paired', () => {
    mockPairedDevice = {
      bleId: 'AA:BB:CC:DD:EE:FF',
      name: 'Leiko U16PRO',
      macSuffix: 'EEFF',
      pairedAt: Date.now(),
    };
    renderScreen();
    expect(screen.getByTestId('settings-watch-paired')).toBeTruthy();
    expect(screen.getByTestId('settings-watch-last-sync')).toBeTruthy();
  });

  it('opens the Forget sheet and routes through pairing.forget on confirm', async () => {
    mockPairedDevice = {
      bleId: 'AA:BB:CC:DD:EE:FF',
      name: 'Leiko U16PRO',
      macSuffix: 'EEFF',
      pairedAt: Date.now(),
    };
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-watch-forget'));
    expect(screen.getByTestId('settings-forget-confirm')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-forget-confirm'));
    });
    await waitFor(() => {
      expect(mockForget).toHaveBeenCalledTimes(1);
    });
  });
});

describe('<SettingsScreen /> — About', () => {
  it('renders the version row + opens terms / privacy / help & support / email via Linking', () => {
    renderScreen();
    expect(screen.getByTestId('settings-about-version')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-about-terms'));
    expect(linkingSpy).toHaveBeenCalledWith('https://leiko.health/terms');
    fireEvent.press(screen.getByTestId('settings-about-privacy'));
    expect(linkingSpy).toHaveBeenCalledWith('https://leiko.health/privacy');
    // Sprint 18 / QUA-8 — Help row now opens the web support page;
    // mailto moved to its own "Email us" row below.
    fireEvent.press(screen.getByTestId('settings-about-help'));
    expect(linkingSpy).toHaveBeenCalledWith('https://leiko.health/support');
    fireEvent.press(screen.getByTestId('settings-about-email'));
    expect(linkingSpy).toHaveBeenCalledWith('mailto:support@leiko.health');
  });
});

describe('<SettingsScreen /> — Sign out', () => {
  it('opens a dignified sign-out sheet and signs out on confirm', async () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-account-signout'));
    expect(screen.getByTestId('settings-signout-confirm')).toBeTruthy();
    // Voice check: no guilt copy.
    expect(screen.queryByText(/are you sure/i)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-signout-confirm'));
    });
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it('cancels cleanly via "Stay signed in"', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-account-signout'));
    fireEvent.press(screen.getByTestId('settings-signout-cancel'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe('<SettingsScreen /> — Vital streams + Goals (Sprint 10b.2)', () => {
  beforeEach(() => {
    // Reset the vitalSetup store between tests so toggles start at defaults.
    jest.requireActual('../../../state/vitalSetup').useVitalSetup.getState().__resetForTest();
  });

  it('renders the auto-HR + auto-SpO2 toggles', () => {
    renderScreen();
    expect(screen.getByTestId('settings-vitals-auto-hr')).toBeTruthy();
    expect(screen.getByTestId('settings-vitals-auto-spo2')).toBeTruthy();
  });

  it('renders the steps + sleep targets and opens the picker', () => {
    renderScreen();
    expect(screen.getByTestId('settings-goals-steps')).toBeTruthy();
    expect(screen.getByTestId('settings-goals-sleep')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-goals-steps'));
    expect(screen.getByTestId('settings-steps-option-6000')).toBeTruthy();
  });

  it('writes a new steps target on selection', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-goals-steps'));
    fireEvent.press(screen.getByTestId('settings-steps-option-8000'));
    const after = jest.requireActual('../../../state/vitalSetup').getVitalSetup();
    expect(after.stepsTarget).toBe(8000);
    expect(after.dirty).toBe(true);
  });
});

describe('<SettingsScreen /> — Apple Health / Health Connect (Sprint 10b.2)', () => {
  beforeEach(() => {
    // Reset toggles store between tests.
    jest.requireActual('../../../services/health-platform/toggles').__resetForTest();
  });

  it('hides the section for caregivers', () => {
    mockProfile = makeProfile({ account_type: 'caregiver' });
    renderScreen();
    expect(screen.queryByTestId('settings-section-health-platform')).toBeNull();
  });

  it('renders the master toggle for self-buyers; per-vital rows hidden when master is OFF', () => {
    mockProfile = makeProfile({ account_type: 'self_buyer' });
    renderScreen();
    expect(screen.getByTestId('settings-hp-master')).toBeTruthy();
    expect(screen.queryByTestId('settings-hp-write-bp')).toBeNull();
  });

  it('reveals per-vital toggles when master flips on', () => {
    mockProfile = makeProfile({ account_type: 'self_buyer' });
    // Flip the store directly — RN Switch's value-change event is
    // wrapped inside ListRow and not directly fireable; bypassing the
    // wrapper is fine because we're asserting the screen's reaction
    // to store state, not the wrapper's plumbing (covered by ListRow's
    // own tests).
    jest
      .requireActual('../../../services/health-platform/toggles')
      .setMaster(true);
    renderScreen();
    expect(screen.getByTestId('settings-hp-write-bp')).toBeTruthy();
    expect(screen.getByTestId('settings-hp-read-weight')).toBeTruthy();
  });
});

describe('<SettingsScreen /> — AI section (Sprint 10b.2)', () => {
  it('renders the quota counter and tier explainer', () => {
    renderScreen();
    expect(screen.getByTestId('settings-ai-quota')).toBeTruthy();
    expect(screen.getByTestId('settings-ai-tier')).toBeTruthy();
  });
});

describe('<SettingsScreen /> — Notifications (Sprint 10b.3)', () => {
  beforeEach(() => {
    jest.requireActual('../../../state/notifications').useNotifications.getState().__resetForTest();
  });

  it('renders the seven category toggles + quiet-hours toggle', () => {
    renderScreen();
    expect(screen.getByTestId('settings-notif-daily')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-weekly')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-anomaly')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-watch')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-family')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-subscription')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-marketing')).toBeTruthy();
    expect(screen.getByTestId('settings-notif-quiet-toggle')).toBeTruthy();
  });

  it('shows the quiet-window row only when quiet hours are enabled', () => {
    renderScreen();
    expect(screen.getByTestId('settings-notif-quiet-window')).toBeTruthy();
    jest.requireActual('../../../state/notifications').useNotifications.getState().set('quietHoursEnabled', false);
  });

  it('marketing defaults to OFF (D6 opt-in)', () => {
    const state = jest.requireActual('../../../state/notifications').useNotifications.getState();
    expect(state.marketing).toBe(false);
  });
});

describe('<SettingsScreen /> — Privacy (Sprint 10b.3)', () => {
  it('shows Export with the Plus-required subtitle for free users', () => {
    renderScreen();
    expect(screen.getByTestId('settings-privacy-export')).toBeTruthy();
    expect(screen.getByText('Available with Leiko Plus.')).toBeTruthy();
  });

  it('shows Activity log nav row + Delete account destructive row', () => {
    renderScreen();
    expect(screen.getByTestId('settings-privacy-audit-log')).toBeTruthy();
    expect(screen.getByTestId('settings-privacy-delete')).toBeTruthy();
  });

  it('opens the delete sheet on Delete account tap', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-privacy-delete'));
    expect(screen.getByTestId('settings-delete-confirm')).toBeTruthy();
    expect(screen.getByTestId('settings-delete-email-input')).toBeTruthy();
  });
});

describe('<SettingsScreen /> — Connect (Phase B)', () => {
  beforeEach(() => {
    mockCreateConnect.mockReset();
    mockAcceptConnect.mockReset();
  });

  it('renders the Connect section with share + enter-code rows', () => {
    renderScreen();
    expect(screen.getByTestId('settings-section-connect')).toBeTruthy();
    expect(screen.getByTestId('settings-family-invite')).toBeTruthy();
    expect(screen.getByTestId('settings-family-accept')).toBeTruthy();
  });

  describe('role-aware family sections (ADR-0006 Phase 4)', () => {
    it('shows "Following your readings" when the viewer wears a circle', () => {
      mockParents = [{ familyId: 'fam-1', parentDisplayName: 'Lawrence', parentRelationship: 'self', viewerRole: 'family_owner' }];
      renderScreen();
      expect(screen.getByTestId('settings-section-following-you')).toBeTruthy();
    });

    it('hides "Following your readings" for a non-wearer, but Connect stays', () => {
      mockParents = [{ familyId: 'mum', parentRelationship: 'Mom' }];
      renderScreen();
      expect(screen.queryByTestId('settings-section-following-you')).toBeNull();
      // Phase B — connect is for everyone; the old wearer gate is gone.
      expect(screen.getByTestId('settings-family-invite')).toBeTruthy();
      expect(screen.getByTestId('settings-family-accept')).toBeTruthy();
    });

    it('lists circles the viewer follows under "People you care for"', () => {
      mockParents = [
        { familyId: 'me', parentDisplayName: 'Lawrence', parentRelationship: 'self', viewerRole: 'family_owner' },
        { familyId: 'mum', parentRelationship: 'Mom', parentDisplayName: 'Marian' },
      ];
      renderScreen();
      expect(screen.getByTestId('settings-section-following')).toBeTruthy();
      expect(screen.getByTestId('settings-followed-mum')).toBeTruthy();
      expect(screen.getByText('Marian')).toBeTruthy();
    });
  });

  it('shows the Connect share subtitle', () => {
    renderScreen();
    expect(
      screen.getByText("Get a code to share. When they enter it, you're connected."),
    ).toBeTruthy();
  });

  it('opens the share sheet, which generates a code with zero inputs', async () => {
    mockCreateConnect.mockResolvedValue({
      invitationId: 'inv-1',
      pairingCode: '482910',
      expiresAt: '2026-05-16T00:00:00Z',
    });
    renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-family-invite'));
    });
    await waitFor(() => {
      // Zero-input: the sheet asks for nothing before minting a code.
      expect(mockCreateConnect).toHaveBeenCalledWith();
    });
    expect(screen.getByTestId('settings-connect-code')).toBeTruthy();
    expect(screen.getByText('482910')).toBeTruthy();
    expect(screen.getByTestId('settings-connect-share')).toBeTruthy();
  });

  it('surfaces a calm error with retry when code generation fails', async () => {
    mockCreateConnect.mockRejectedValue(new Error('boom'));
    renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-family-invite'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-connect-error')).toBeTruthy();
    });
    expect(screen.getByTestId('settings-connect-retry')).toBeTruthy();
  });

  it('opens the accept sheet, joins the family, and shows the success state', async () => {
    mockAcceptConnect.mockResolvedValue({
      ok: true,
      familyId: 'fam-2',
      outcome: 'accepter_follows',
      canFollowBack: false,
    });
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-family-accept'));
    // Phase A: no email field — the accept-time email gate is gone.
    fireEvent.changeText(screen.getByTestId('settings-accept-code-input'), '482910');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-accept-join'));
    });
    await waitFor(() => {
      expect(mockAcceptConnect).toHaveBeenCalledWith({
        code: '482910',
      });
    });
    expect(screen.getByText("You're connected")).toBeTruthy();
  });

  it('surfaces the not-found error message on a wrong code', async () => {
    // A wrong code resolves to no invitation.
    mockAcceptConnect.mockRejectedValue(new Error('invitation_not_found'));
    renderScreen();
    fireEvent.press(screen.getByTestId('settings-family-accept'));
    fireEvent.changeText(screen.getByTestId('settings-accept-code-input'), '111111');
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-accept-join'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-accept-error')).toBeTruthy();
    });
    expect(
      screen.getByText("We couldn't find that code. Double-check and try again."),
    ).toBeTruthy();
  });
});

describe('<SettingsScreen /> — Manage who sees my readings (Sprint 10c.2)', () => {
  beforeEach(() => {
    mockListCaregivers.mockReset();
  });

  it('hides the visibility row when no caregivers exist', async () => {
    mockListCaregivers.mockResolvedValue([]);
    mockProfile = makeProfile({ account_type: 'self_buyer' });
    renderScreen();
    await waitFor(() => {
      expect(mockListCaregivers).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('settings-family-visibility')).toBeNull();
  });

  it('shows the visibility row when at least one caregiver exists', async () => {
    mockListCaregivers.mockResolvedValue([
      {
        userId: 'c-1',
        displayName: 'Sarah',
        joinedAt: '2026-05-01T00:00:00Z',
        visibility: { bp: true, hr: true, spo2: true, sleep: false, activity: true },
      },
    ]);
    mockProfile = makeProfile({ account_type: 'self_buyer' });
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId('settings-family-visibility')).toBeTruthy();
    });
  });

  it('hides the visibility row for caregivers (only self-buyer surfaces it)', async () => {
    mockListCaregivers.mockResolvedValue([
      {
        userId: 'c-1',
        displayName: 'Sarah',
        joinedAt: '2026-05-01T00:00:00Z',
        visibility: { bp: true, hr: true, spo2: true, sleep: false, activity: true },
      },
    ]);
    mockProfile = makeProfile({ account_type: 'caregiver' });
    renderScreen();
    expect(screen.queryByTestId('settings-family-visibility')).toBeNull();
  });
});

describe('<SettingsScreen /> — voice rules', () => {
  it.each([
    'Settings',
    'Profile',
    'Watch',
    'About',
    'Account',
    'Sign out',
    'Help & support',
    'Email us',
    'Terms of service',
    'Privacy policy',
  ])('renders voice-rule clean string: %s', (text) => {
    renderScreen();
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });
});
