// PersonOverviewScreen — D13 PR-8 (§7.2a). The done-when slice this
// suite owns: person taps land here, the self node shows self-framed
// copy (P2-8), and the five-vital monitor renders one row per vital
// with verdicts that never outrun the truth layer.

jest.mock('../../../hooks/useParentDailyPulseData', () => ({
  useParentDailyPulseData: jest.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    wearerTimeZone: 'Africa/Lagos',
  })),
}));
jest.mock('../../../services/supabase', () => ({
  supabase: { from: jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ data: [], error: null })) })) })) },
}));

import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersonOverviewScreen } from '../PersonOverviewScreen';
import { ThemeProvider } from '../../../theme';
import { mmkv } from '../../../services/storage';
import { __resetVitalBaselinesForTests } from '../../../utils/vitalBaselines';

function mount(props: Partial<React.ComponentProps<typeof PersonOverviewScreen>> = {}) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver" colorMode="dark">
        <PersonOverviewScreen
          onBack={jest.fn()}
          onOpenVital={jest.fn()}
          {...props}
        />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  mmkv.clearAll();
  __resetVitalBaselinesForTests();
});

describe('subject framing (P2-8)', () => {
  it('the self path renders second-person copy', () => {
    mount({ isSelf: true });
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('a named person renders their name, never a pronoun guess', () => {
    mount({ familyId: 'fam-1', personName: 'Marian Okeke' });
    expect(screen.getByText('Marian Okeke')).toBeTruthy();
  });

  it('a missing name falls back to the §7.4 phrase', () => {
    mount({ familyId: 'fam-1' });
    expect(screen.getByText('Your family member')).toBeTruthy();
  });
});

describe('the five-vital monitor (§6.4)', () => {
  it('renders one row per vital, learning verdicts with no server rows', () => {
    mount({ familyId: 'fam-1', personName: 'Marian Okeke' });
    for (const key of ['bp', 'hr', 'spo2', 'sleep', 'activity']) {
      const row = screen.getByTestId(`person-overview-row-${key}`);
      expect(row.props.accessibilityLabel).toContain('Learning');
      expect(row.props.accessibilityLabel).not.toContain('usual range');
    }
  });

  it('a row tap opens that vital scoped to the person', () => {
    const onOpenVital = jest.fn();
    mount({ familyId: 'fam-1', personName: 'Marian Okeke', onOpenVital });
    fireEvent.press(screen.getByTestId('person-overview-row-hr'));
    expect(onOpenVital).toHaveBeenCalledWith('hr', 'fam-1');
  });
});

describe('voice', () => {
  it('never renders a forbidden phrase', () => {
    const tree = mount({ familyId: 'fam-1', personName: 'Marian Okeke' });
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).not.toMatch(/in pattern|ALL CLEAR|within your range|loved one|patient/i);
  });
});
