// MedicationSection — D13 PR-11 (§4.5/§7.6). "What you take and when" —
// never treatment, adherence, compliance or dosing. It records that
// something was taken; it never advises, never reminds in a scolding
// register, and never reports a missed dose as a failure. Every string
// is the §7.6 table, verbatim; the not-logged state is a flat
// statement — no "missed", no "overdue", no colour, no push.
//
// Labels are free text and NEVER leave the device inside an AI prompt
// payload (§9.3) — surfaces send medication_logged_today as a boolean.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE } from '../theme/fontScaling';
import { supabase } from '../services/supabase';
import { timeInZone } from '../utils/timeInZone';

interface MedicationRow {
  id: string;
  label: string;
  loggedTodayAt: string | null;
}

export interface MedicationSectionProps {
  familyId: string;
  subjectName: string;
  /** The signed-in user (logged_by). */
  viewerUserId: string;
  /** The wearer (subject_id on rows). */
  subjectUserId: string;
  timeZone?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function MedicationSection({
  familyId,
  subjectName,
  viewerUserId,
  subjectUserId,
  timeZone,
  testID = 'medication-section',
  style,
}: MedicationSectionProps) {
  const theme = useTheme();
  const [rows, setRows] = useState<MedicationRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const title = theme.type('title');
  const bodyM = theme.type('bodyM');
  const caption = theme.type('caption');

  const refresh = useCallback(async () => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [meds, events] = await Promise.all([
        supabase
          .from('medications')
          .select('id, label')
          .eq('family_id', familyId)
          .eq('active', true),
        supabase
          .from('medication_events')
          .select('medication_id, taken_at')
          .eq('subject_id', subjectUserId)
          .gte('taken_at', startOfDay.toISOString()),
      ]);
      if (meds.error || !meds.data) return;
      const eventsByMed = new Map<string, string>();
      for (const e of events.data ?? []) {
        eventsByMed.set(e.medication_id as string, e.taken_at as string);
      }
      setRows(
        (meds.data as Array<{ id: string; label: string }>).map((m) => ({
          id: m.id,
          label: m.label,
          loggedTodayAt: eventsByMed.get(m.id) ?? null,
        })),
      );
    } catch {
      // Offline keeps whatever rendered last; the section never blocks.
    }
  }, [familyId, subjectUserId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addMedication = async () => {
    const label = newLabel.trim().slice(0, 80);
    if (!label) return;
    setNewLabel('');
    setAdding(false);
    await supabase.from('medications').insert({
      family_id: familyId,
      subject_id: subjectUserId,
      label,
      schedule: { times: [], days: [] },
    });
    void refresh();
  };

  const logTaken = async (medicationId: string) => {
    await supabase.from('medication_events').insert({
      medication_id: medicationId,
      subject_id: subjectUserId,
      taken_at: new Date().toISOString(),
      logged_by: viewerUserId,
    });
    void refresh();
  };

  return (
    <View
      style={[
        {
          marginHorizontal: theme.spacing.l,
          marginTop: theme.spacing.l,
          padding: theme.spacing.l,
          backgroundColor: theme.colors.surface.warmElevated,
          borderRadius: theme.radii.l,
        },
        style,
      ]}
      testID={testID}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[title, { color: theme.colors.text.primary }]}
      >
        {`What ${subjectName} takes`}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[caption, { color: theme.colors.text.tertiary, marginTop: 2 }]}
        testID={`${testID}-subtitle`}
      >
        A simple medication log — a record of what's taken and when, shown
        alongside the readings and on the doctor summary.
      </Text>

      {rows.length === 0 && !adding ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[bodyM, { color: theme.colors.text.secondary, marginTop: theme.spacing.s }]}
          testID={`${testID}-empty`}
        >
          {`Nothing added yet. Adding what ${subjectName} takes helps us show you the fuller picture alongside the readings.`}
        </Text>
      ) : null}

      {rows.map((row) => (
        <View
          key={row.id}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={`${row.label}. ${
            row.loggedTodayAt
              ? `Logged, ${timeInZone(Date.parse(row.loggedTodayAt), timeZone ?? 'UTC')}.`
              : 'Nothing logged today.'
          }`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 48,
            marginTop: theme.spacing.s,
          }}
          testID={`${testID}-row-${row.id}`}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[bodyM, { color: theme.colors.text.primary }]}
              numberOfLines={1}
            >
              {row.label}
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[caption, { color: theme.colors.text.tertiary }]}
            >
              {row.loggedTodayAt
                ? `Logged, ${timeInZone(Date.parse(row.loggedTodayAt), timeZone ?? 'UTC')}.`
                : 'Nothing logged today.'}
            </Text>
          </View>
          {!row.loggedTodayAt ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Log ${row.label} as taken`}
              onPress={() => void logTaken(row.id)}
              style={{ minHeight: 44, paddingHorizontal: theme.spacing.m, justifyContent: 'center' }}
              testID={`${testID}-log-${row.id}`}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[caption, { color: theme.colors.text.secondary, textDecorationLine: 'underline' }]}
              >
                Log as taken
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {adding ? (
        <View style={{ marginTop: theme.spacing.m }}>
          <TextInput
            value={newLabel}
            onChangeText={(t) => setNewLabel(t.slice(0, 80))}
            placeholder="Name"
            placeholderTextColor={theme.colors.text.tertiary}
            maxLength={80}
            accessibilityLabel="Name of what they take"
            style={[
              bodyM,
              {
                color: theme.colors.text.primary,
                borderWidth: 0.5,
                borderColor: theme.colors.border.rim,
                borderRadius: theme.radii.m,
                padding: theme.spacing.m,
              },
            ]}
            testID={`${testID}-add-input`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            onPress={() => void addMedication()}
            style={{ minHeight: 44, justifyContent: 'center', marginTop: theme.spacing.s }}
            testID={`${testID}-add-save`}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[bodyM, { color: theme.colors.text.secondary, textDecorationLine: 'underline' }]}
            >
              Save
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add something"
          onPress={() => setAdding(true)}
          style={{ minHeight: 44, justifyContent: 'center', marginTop: theme.spacing.s }}
          testID={`${testID}-add`}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[caption, { color: theme.colors.text.secondary, textDecorationLine: 'underline' }]}
          >
            Add something
          </Text>
        </Pressable>
      )}
    </View>
  );
}
