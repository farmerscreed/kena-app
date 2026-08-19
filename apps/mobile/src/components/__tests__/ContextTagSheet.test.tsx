// ContextTagSheet — §6.5: time-derived defaults, never blocking,
// tags optional.
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ContextTagSheet, defaultTagsForHour } from '../ContextTagSheet';
import { ThemeProvider } from '../../theme';

function mount(props: Partial<React.ComponentProps<typeof ContextTagSheet>> = {}) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <ThemeProvider mode="caregiver" colorMode="dark">
        <ContextTagSheet
          visible
          readingHour={8}
          onSave={jest.fn()}
          onDismiss={jest.fn()}
          {...props}
        />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('time-derived defaults (§6.5)', () => {
  it('before noon → morning; from five → evening; midday → none', () => {
    expect(defaultTagsForHour(7)).toEqual(['morning']);
    expect(defaultTagsForHour(11)).toEqual(['morning']);
    expect(defaultTagsForHour(12)).toEqual([]);
    expect(defaultTagsForHour(16)).toEqual([]);
    expect(defaultTagsForHour(17)).toEqual(['evening']);
    expect(defaultTagsForHour(22)).toEqual(['evening']);
  });

  it('the default is pre-applied but editable', () => {
    const onSave = jest.fn();
    mount({ readingHour: 8, onSave });
    const morning = screen.getByTestId('context-tag-sheet-tag-morning');
    expect(morning.props.accessibilityState.checked).toBe(true);
    fireEvent.press(morning); // deselect — the user's call
    fireEvent.press(screen.getByTestId('context-tag-sheet-save'));
    expect(onSave).toHaveBeenCalledWith([], null);
  });
});

describe('never blocking', () => {
  it('dismiss saves nothing — a reading with no tags is valid', () => {
    const onDismiss = jest.fn();
    const onSave = jest.fn();
    mount({ onDismiss, onSave });
    fireEvent.press(screen.getByTestId('context-tag-sheet-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
