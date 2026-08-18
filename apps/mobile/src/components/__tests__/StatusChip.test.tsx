// StatusChip — D13 PR-2 (§6.1, §7.4). The snapshot matrix renders every
// tier × every subject shape so any vocabulary drift shows up as a
// diff, and the voice rules are asserted directly: sentence case (no
// uppercase transform), no forbidden words, verdict never colour-only.

import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusChip } from '../StatusChip';
import { ThemeProvider } from '../../theme';
import {
  FALLBACK_SUBJECT,
  SELF_SUBJECT,
  subjectFor,
  type Subject,
} from '../../services/voice/tierVocabulary';
import type { Tier } from '../../utils/classification';

const TIERS: Tier[] = ['learning', 'in_range', 'worth_a_look', 'talk_to_doctor'];
const SUBJECTS: Array<[string, Subject]> = [
  ['self', SELF_SUBJECT],
  ['named-her', subjectFor('Mum', 'her')],
  ['named-his', subjectFor('Dad', 'his')],
  ['named-default-possessive', subjectFor('Marian')],
  ['fallback', FALLBACK_SUBJECT],
];

function mount(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver" colorMode="dark">
        {ui}
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('StatusChip — tier × subject matrix', () => {
  it.each(
    TIERS.flatMap((tier) => SUBJECTS.map(([name, subject]) => [tier, name, subject] as const)),
  )('%s × %s renders the canonical copy', (tier, _name, subject) => {
    const tree = mount(<StatusChip tier={tier} subject={subject} testID="chip" />);
    expect(tree.toJSON()).toMatchSnapshot();
  });

  it('renders sentence case — never an uppercase transform', () => {
    mount(<StatusChip tier="in_range" testID="chip" />);
    const texts = screen.UNSAFE_getAllByType(Text);
    for (const t of texts) {
      const style = Array.isArray(t.props.style)
        ? Object.assign({}, ...t.props.style.flat().filter(Boolean))
        : (t.props.style ?? {});
      expect(style.textTransform).not.toBe('uppercase');
    }
  });

  it('carries the verdict as text, not colour alone', () => {
    mount(<StatusChip tier="worth_a_look" testID="chip" />);
    expect(screen.getByText('Worth a look')).toBeTruthy();
  });

  it('possessive flows into the in-range chip', () => {
    mount(<StatusChip tier="in_range" subject={subjectFor('Dad', 'his')} />);
    expect(screen.getByText('In his usual range')).toBeTruthy();
  });

  it('is hidden from the a11y tree when nested in a labelled card', () => {
    const tree = mount(
      <StatusChip tier="in_range" nestedInLabelledCard testID="chip" />,
    );
    const chip = tree.getByTestId('chip', { includeHiddenElements: true });
    expect(chip.props.accessibilityElementsHidden).toBe(true);
  });

  it('never renders a forbidden phrase for any tier × subject', () => {
    for (const tier of TIERS) {
      for (const [, subject] of SUBJECTS) {
        const tree = mount(<StatusChip tier={tier} subject={subject} />);
        const rendered = JSON.stringify(tree.toJSON());
        expect(rendered).not.toMatch(/in pattern|ALL CLEAR|within your range|loved one/i);
        tree.unmount();
      }
    }
  });
});
