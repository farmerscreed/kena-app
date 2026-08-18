// PersonOverviewScreen — D13 PR-8 (§7.2a). Level 2 of the decided
// hierarchy Home → Person Overview → Vital Detail: everything about one
// individual on a single pushed screen — latest reading with its
// verdict, one derived sentence, the five-vital monitor, recent
// readings, and the doctor-note link.
//
// One component serves both subjects: the caregiver path passes
// `familyId` (the parent's circle); the self path omits it and the
// copy switches to second person via the Subject object (§7.4). This
// is also what closes P2-8 — tapping your own node lands here with
// self-framed copy, because `isSelf` travels with the route instead of
// being re-derived (wrongly) downstream.
//
// The Steadiness ring (§7.2a line 2) is FF_STEADINESS work — blocked on
// counsel sign-off and deliberately absent here.

import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { MAX_FONT_SCALE, MAX_FONT_SCALE_TIGHT } from '../../theme/fontScaling';
import { CanvasGradient } from '../../components/CanvasGradient';
import { StatusChip } from '../../components/StatusChip';
import { HealthMonitorRow } from '../../components/HealthMonitorRow';
import { useDailyPulseData, emptyDailyPulse } from '../../state/dailyPulse';
import { useParentDailyPulseData } from '../../hooks/useParentDailyPulseData';
import {
  canonicalTierFor,
  classifyVital,
  type Tier,
} from '../../utils/classification';
import { getServerBaseline, type BaselineVital } from '../../utils/vitalBaselines';
import {
  sentenceFragmentForTier,
  subjectFor,
  SELF_SUBJECT,
  type Subject,
} from '../../services/voice/tierVocabulary';
import { timeInZone } from '../../utils/timeInZone';
import { LEARNING_COPY } from '../../utils/calibration';
import { mmkv, STORAGE_KEYS } from '../../services/storage';
import { MedicationSection } from '../../components/MedicationSection';
import { useAuth } from '../../state/auth';

export interface PersonOverviewScreenProps {
  /** The person's circle — omitted on the self path. */
  familyId?: string;
  /** Display name; the §7.4 fallback applies when missing. */
  personName?: string;
  isSelf?: boolean;
  onBack: () => void;
  onOpenVital: (
    vital: 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity',
    familyId: string | null,
  ) => void;
  onDoctorPress?: () => void;
  testID?: string;
}

/** Truth-layer tier for a non-BP vital: the §4.4 rules over the
 *  server row; learning whenever the row is absent or unearned. */
function tierFor(
  familyId: string,
  vital: BaselineVital,
  value: number | null,
): { tier: Tier; bandLabel: string | null } {
  const row = getServerBaseline(familyId, vital);
  if (!row || !row.isSufficient || value == null) {
    return { tier: 'learning', bandLabel: null };
  }
  const verdict = classifyVital({ vital, value }, row);
  return {
    tier: verdict.tier,
    bandLabel: `usual ${Math.round(row.p10)}–${Math.round(row.p90)}`,
  };
}

export function PersonOverviewScreen({
  familyId,
  personName,
  isSelf = false,
  onBack,
  onOpenVital,
  onDoctorPress,
  testID = 'person-overview',
}: PersonOverviewScreenProps) {
  const theme = useTheme();
  const viewerUserId = useAuth((s) => s.profile?.id ?? null);
  const ownPulse = useDailyPulseData();
  const parentPulse = useParentDailyPulseData(familyId ?? null);
  const isCaregiverScoped = familyId != null;
  const data = isCaregiverScoped
    ? (parentPulse.data ?? emptyDailyPulse())
    : ownPulse;
  const tz = isCaregiverScoped
    ? (parentPulse.wearerTimeZone ?? 'UTC')
    : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const bandFamilyId =
    familyId ?? mmkv.getString(STORAGE_KEYS.currentFamilyId) ?? '';

  const subject: Subject = isSelf
    ? SELF_SUBJECT
    : subjectFor(personName?.split(' ')[0] ?? null);

  const latest = data.bp.latest;
  const bpTier: Tier | null = data.bp.classification
    ? canonicalTierFor(data.bp.classification)
    : null;

  // "What Leiko sees" — ONE derived sentence, §7.4 vocabulary only.
  const seenSentence = useMemo(() => {
    if (!latest || !bpTier) {
      return isSelf
        ? LEARNING_COPY.monitorAllLearning.body
        : `${LEARNING_COPY.monitorAllLearning.headline(subject.label)}. ${LEARNING_COPY.monitorAllLearning.body}`;
    }
    const lead = isSelf ? 'Your latest reading' : `${subject.label}'s latest reading`;
    return `${lead} ${sentenceFragmentForTier(bpTier, subject)}.`;
  }, [latest, bpTier, isSelf, subject]);

  // The five monitor rows.
  const rows = useMemo(() => {
    const sysRow = getServerBaseline(bandFamilyId, 'bp_systolic');
    const bpBand =
      sysRow && sysRow.isSufficient
        ? `usual ${Math.round(sysRow.p10)}–${Math.round(sysRow.p90)}`
        : null;
    const hr = tierFor(bandFamilyId, 'resting_hr', data.hr.restingToday);
    const spo2Low =
      data.spo2.overnightLowsRecent.length > 0
        ? data.spo2.overnightLowsRecent[data.spo2.overnightLowsRecent.length - 1]
        : null;
    const spo2 = tierFor(bandFamilyId, 'spo2', spo2Low);
    const sleepMin = data.sleep.session?.totalMinutes ?? null;
    const sleep = tierFor(bandFamilyId, 'sleep_duration', sleepMin);
    const steps = data.activity.stepsToday;
    const activity = tierFor(bandFamilyId, 'steps_daily', steps || null);
    return [
      {
        key: 'bp' as const,
        name: 'Blood pressure',
        value: latest ? `${latest.systolic}/${latest.diastolic}` : '—',
        bandLabel: bpBand,
        series: [] as number[],
        tier: (bpTier ?? 'learning') as Tier,
      },
      {
        key: 'hr' as const,
        name: 'Resting heart rate',
        value: data.hr.restingToday != null ? String(Math.round(data.hr.restingToday)) : '—',
        bandLabel: hr.bandLabel,
        series: [] as number[],
        tier: hr.tier,
      },
      {
        key: 'spo2' as const,
        name: 'Overnight oxygen',
        value: spo2Low != null ? `${Math.round(spo2Low)}%` : '—',
        bandLabel: spo2.bandLabel,
        series: data.spo2.overnightLowsRecent.slice(-14),
        tier: spo2.tier,
      },
      {
        key: 'sleep' as const,
        name: 'Sleep',
        value:
          sleepMin != null
            ? `${Math.floor(sleepMin / 60)}:${String(sleepMin % 60).padStart(2, '0')} hrs`
            : '—',
        bandLabel: sleep.bandLabel,
        series: [] as number[],
        tier: sleep.tier,
      },
      {
        key: 'activity' as const,
        name: 'Movement',
        value: steps ? `${steps.toLocaleString()} steps` : '—',
        bandLabel: activity.bandLabel,
        series: [] as number[],
        tier: activity.tier,
      },
    ];
  }, [bandFamilyId, data, latest, bpTier]);

  const title = theme.type('title');
  const numericXl = theme.type('numericXl');
  const caption = theme.type('caption');
  const voice = theme.fontFamilies.editorial;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface.warmBase }} testID={testID}>
      <CanvasGradient />
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Header — back (caregiver) / plain title (self). */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.l,
            paddingTop: 56,
            paddingBottom: theme.spacing.m,
            gap: theme.spacing.m,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack}
            hitSlop={12}
            testID={`${testID}-back`}
            style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[title, { color: theme.colors.text.secondary }]}
            >
              ‹
            </Text>
          </Pressable>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[title, { color: theme.colors.text.primary, flex: 1 }]}
            numberOfLines={1}
          >
            {isSelf ? 'You' : (personName?.trim() || 'Your family member')}
          </Text>
        </View>

        {/* Latest reading + verdict. */}
        <View
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={
            latest
              ? `${isSelf ? 'Your' : `${subject.label}'s`} latest blood pressure, ${latest.systolic} over ${latest.diastolic}, ${bpTier ? sentenceFragmentForTier(bpTier, subject) : ''}`
              : 'No readings yet'
          }
          style={{ paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.m }}
          testID={`${testID}-latest`}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            style={{
              fontFamily: numericXl.family,
              fontVariant: ['tabular-nums'],
              fontSize: numericXl.size,
              lineHeight: numericXl.lineHeight,
              color: theme.colors.text.primary,
            }}
          >
            {latest ? `${latest.systolic}/${latest.diastolic}` : '—'}
          </Text>
          {latest && data.bp.latestSampleSec != null ? (
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
              style={{
                fontFamily: theme.fontFamilies.eyebrow,
                fontSize: 11,
                lineHeight: 14,
                letterSpacing: 0.88,
                textTransform: 'uppercase',
                color: theme.colors.text.tertiary,
                marginTop: 2,
              }}
            >
              {`MMHG · ${timeInZone(data.bp.latestSampleSec * 1000, tz || 'UTC')}`}
            </Text>
          ) : null}
          {bpTier ? (
            <StatusChip
              tier={bpTier}
              subject={subject}
              size="s"
              nestedInLabelledCard
              style={{ marginTop: theme.spacing.s }}
            />
          ) : null}
        </View>

        {/* "What Leiko sees" — the voice slot. */}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: voice,
            fontSize: 18,
            lineHeight: 26,
            color: theme.colors.text.secondary,
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.m,
          }}
          testID={`${testID}-seen`}
        >
          {seenSentence}
        </Text>

        {/* The five-vital monitor (§6.4). */}
        <View
          style={{
            marginHorizontal: theme.spacing.l,
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.s,
            backgroundColor: theme.colors.surface.warmElevated,
            borderRadius: theme.radii.l,
          }}
          testID={`${testID}-monitor`}
        >
          {rows.map((row) => (
            <HealthMonitorRow
              key={row.key}
              name={row.name}
              value={row.value}
              bandLabel={row.bandLabel}
              series={row.series}
              tier={row.tier}
              subject={subject}
              onPress={() => onOpenVital(row.key, familyId ?? null)}
              testID={`${testID}-row-${row.key}`}
            />
          ))}
        </View>

        {/* D13 PR-11 (§7.6) — the medication log. Self path only until
            the caregiver route carries the wearer's user id (the RLS
            write path needs subject_id, which the caregiver client
            does not hold today). */}
        {isSelf && viewerUserId ? (
          <MedicationSection
            familyId={bandFamilyId}
            subjectName="you"
            viewerUserId={viewerUserId}
            subjectUserId={viewerUserId}
            timeZone={tz || 'UTC'}
            testID={`${testID}-medications`}
          />
        ) : null}

        {onDoctorPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isSelf ? 'For your doctor' : `For ${subject.possessive} doctor`
            }
            onPress={onDoctorPress}
            style={{
              marginHorizontal: theme.spacing.l,
              marginTop: theme.spacing.l,
              minHeight: 44,
              justifyContent: 'center',
            }}
            testID={`${testID}-doctor`}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[
                caption,
                { color: theme.colors.text.secondary, textDecorationLine: 'underline' },
              ]}
            >
              {isSelf ? 'For your doctor' : `For ${subject.possessive} doctor`}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
