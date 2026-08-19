// useAnnounce — audit finding P1-7.
//
// The contract under test: iOS speaks, Android stays quiet (because
// accessibilityLiveRegion already covers it there), and nothing is spoken
// twice for the same sentence.

import { AccessibilityInfo, Platform, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  announceForAccessibility,
  useAnnounce,
  useAnnounceOnChange,
} from '../useAnnounce';

function Announcer({ message }: { message: string | null }) {
  useAnnounceOnChange(message);
  return <Text>announcer</Text>;
}

function ImperativeAnnouncer({ message }: { message: string }) {
  const announce = useAnnounce();
  announce(message);
  return <Text>imperative</Text>;
}

describe('announceForAccessibility', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    jest.restoreAllMocks();
  });

  it('speaks the message on iOS', () => {
    announceForAccessibility('Reading saved. 128 over 82.');
    expect(spy).toHaveBeenCalledWith('Reading saved. 128 over 82.');
  });

  it('stays silent on Android — accessibilityLiveRegion already announces there', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    announceForAccessibility('Reading saved. 128 over 82.');
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores blank, whitespace-only, null and undefined messages', () => {
    announceForAccessibility('');
    announceForAccessibility('   ');
    announceForAccessibility(null);
    announceForAccessibility(undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  it('trims the message before speaking it', () => {
    announceForAccessibility('  Paired. The watch is connected.  ');
    expect(spy).toHaveBeenCalledWith('Paired. The watch is connected.');
  });
});

describe('useAnnounceOnChange', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    jest.restoreAllMocks();
  });

  it('announces once on mount', () => {
    render(<Announcer message="Looking for the watch." />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('Looking for the watch.');
  });

  it('does not repeat itself when re-rendered with the same sentence', () => {
    const { rerender } = render(<Announcer message="Looking for the watch." />);
    rerender(<Announcer message="Looking for the watch." />);
    rerender(<Announcer message="Looking for the watch." />);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('announces again when the sentence changes', () => {
    const { rerender } = render(<Announcer message="Looking for the watch." />);
    rerender(<Announcer message="Paired. The watch is connected." />);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith('Paired. The watch is connected.');
  });

  it('clears its memory on null so the same sentence can announce again', () => {
    const { rerender } = render(<Announcer message="Top number should be between 30 and 300." />);
    rerender(<Announcer message={null} />);
    rerender(<Announcer message="Top number should be between 30 and 300." />);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('says nothing at all on Android', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<Announcer message="Looking for the watch." />);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('useAnnounce', () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
    jest.restoreAllMocks();
  });

  it('returns a callable announcer', () => {
    render(<ImperativeAnnouncer message="A new reading just came in." />);
    expect(spy).toHaveBeenCalledWith('A new reading just came in.');
  });
});
