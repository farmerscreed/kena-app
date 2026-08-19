// The matrix's three honest states — found / honest negative /
// counting — and never a computed statistic of its own.

const mockRows: unknown[] = [];
jest.mock('../../services/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          in: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: mockRows, error: null })),
            })),
          })),
        })),
      })),
    })),
  },
}));

import { render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersonalFindingsCard, honestNegativeLine } from '../PersonalFindingsCard';
import { ThemeProvider } from '../../theme';
import { lintVoiceText } from '../../services/voice/voiceLint';

function mount(pairs: Parameters<typeof PersonalFindingsCard>[0]['pairs']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={qc}>
        <ThemeProvider mode="caregiver" colorMode="dark">
          <PersonalFindingsCard familyId="fam-1" pairs={pairs} />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mockRows.length = 0;
});

it('a meaningful row renders the engine narrative verbatim', async () => {
  mockRows.push({
    correlation_type: 'activity_x_resting_hr',
    is_meaningful: true,
    sample_n: 21,
    narrative_long:
      'Days with more steps tracked alongside a lower resting heart rate over the last 21 days.',
    computed_at: '2026-08-19T04:00:00Z',
  });
  mount(['activity_x_resting_hr']);
  await waitFor(() =>
    expect(screen.getByTestId('personal-findings-found-activity_x_resting_hr')).toBeTruthy(),
  );
});

it('cleared-n but not meaningful renders the honest negative, never silence', async () => {
  mockRows.push({
    correlation_type: 'sleep_x_resting_hr',
    is_meaningful: false,
    sample_n: 18,
    narrative_long: null,
    computed_at: '2026-08-19T04:00:00Z',
  });
  mount(['sleep_x_resting_hr']);
  await waitFor(() =>
    expect(screen.getByTestId('personal-findings-negative-sleep_x_resting_hr')).toBeTruthy(),
  );
  expect(
    screen.getByText(/didn't find a pattern. That's common, and it isn't a problem/),
  ).toBeTruthy();
});

it('below n renders the counting state', async () => {
  mockRows.push({
    correlation_type: 'after_meds_x_bp',
    is_meaningful: false,
    sample_n: 6,
    narrative_long: null,
    computed_at: '2026-08-19T04:00:00Z',
  });
  mount(['after_meds_x_bp']);
  await waitFor(() =>
    expect(screen.getByTestId('personal-findings-counting-after_meds_x_bp')).toBeTruthy(),
  );
});

it('every honest-negative line passes the voice lint for every pair', () => {
  const pairs = [
    'sleep_x_morning_bp',
    'activity_x_resting_hr',
    'spo2_dip_x_sleep_score',
    'sleep_x_resting_hr',
    'activity_x_morning_bp',
    'after_meds_x_bp',
  ] as const;
  for (const pair of pairs) {
    const line = honestNegativeLine(pair, 18);
    expect(lintVoiceText(line).hardHits).toEqual([]);
    expect(line).not.toMatch(/because|caused|working/i);
  }
});
