// ContextTagSheet — D13 PR-11 (§6.5). Presented after a reading
// completes and reachable from any reading detail. Multi-select chips
// from the reading_context enum plus an optional 280-char note.
//
// Default selection is time-derived (morning before 12:00 local,
// evening after 17:00), pre-applied but editable. NEVER blocking — the
// sheet is dismissible and a reading with no tags is valid.

import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE, MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export const READING_CONTEXT_TAGS = [
  'morning',
  'evening',
  'before_meds',
  'after_meds',
  'after_walking',
  'feeling_unwell',
  'resting',
] as const;

export type ReadingContextTag = (typeof READING_CONTEXT_TAGS)[number];

const TAG_LABEL: Record<ReadingContextTag, string> = {
  morning: 'Morning',
  evening: 'Evening',
  before_meds: 'Before meds',
  after_meds: 'After meds',
  after_walking: 'After walking',
  feeling_unwell: 'Feeling unwell',
  resting: 'Resting',
};

/** §6.5 — time-derived defaults, editable. Exported for tests. */
export function defaultTagsForHour(hour: number): ReadingContextTag[] {
  if (hour < 12) return ['morning'];
  if (hour >= 17) return ['evening'];
  return [];
}

export interface ContextTagSheetProps {
  visible: boolean;
  /** Local hour of the reading being tagged. */
  readingHour: number;
  onSave: (tags: ReadingContextTag[], note: string | null) => void;
  onDismiss: () => void;
  testID?: string;
}

export function ContextTagSheet({
  visible,
  readingHour,
  onSave,
  onDismiss,
  testID = 'context-tag-sheet',
}: ContextTagSheetProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<ReadingContextTag[]>(() =>
    defaultTagsForHour(readingHour),
  );
  const [note, setNote] = useState('');
  const label = theme.type('label');
  const bodyM = theme.type('bodyM');

  const toggle = (tag: ReadingContextTag) =>
    setSelected((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title="Anything worth noting?"
      size="compact"
      surface="solid"
      testID={testID}
    >
      <View style={{ paddingHorizontal: theme.spacing.l, paddingBottom: theme.spacing.l }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s }}>
          {READING_CONTEXT_TAGS.map((tag) => {
            const on = selected.includes(tag);
            return (
              <Pressable
                key={tag}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={TAG_LABEL[tag]}
                onPress={() => toggle(tag)}
                style={{
                  minHeight: 44,
                  paddingHorizontal: theme.spacing.m,
                  justifyContent: 'center',
                  borderRadius: 99,
                  borderWidth: 0.5,
                  borderColor: theme.colors.border.rim,
                  backgroundColor: on
                    ? theme.colors.surface.warmElevated
                    : 'transparent',
                }}
                testID={`${testID}-tag-${tag}`}
              >
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
                  style={[
                    label,
                    {
                      color: on
                        ? theme.colors.text.primary
                        : theme.colors.text.secondary,
                    },
                  ]}
                >
                  {TAG_LABEL[tag]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={note}
          onChangeText={(t) => setNote(t.slice(0, 280))}
          placeholder="Add a note (optional)"
          placeholderTextColor={theme.colors.text.tertiary}
          multiline
          maxLength={280}
          accessibilityLabel="Note, optional"
          style={[
            bodyM,
            {
              color: theme.colors.text.primary,
              borderWidth: 0.5,
              borderColor: theme.colors.border.rim,
              borderRadius: theme.radii.m,
              padding: theme.spacing.m,
              marginTop: theme.spacing.l,
              minHeight: 64,
              textAlignVertical: 'top',
            },
          ]}
          testID={`${testID}-note`}
        />
        <View style={{ flexDirection: 'row', gap: theme.spacing.m, marginTop: theme.spacing.l }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            onPress={() => onSave(selected, note.trim() || null)}
            style={{
              flex: 1,
              minHeight: 48,
              borderRadius: theme.radii.l,
              backgroundColor: theme.colors.brand.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            testID={`${testID}-save`}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[bodyM, { color: theme.colors.text.onBrand, fontWeight: '600' }]}
            >
              Save
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Not now"
            onPress={onDismiss}
            style={{ minHeight: 48, paddingHorizontal: theme.spacing.l, justifyContent: 'center' }}
            testID={`${testID}-dismiss`}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[bodyM, { color: theme.colors.text.secondary }]}
            >
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}
