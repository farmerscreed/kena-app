// "For your doctor" — Trends v2 follow-up.
//
// Single-job screen: generate a doctor-shareable PDF of recent
// five-vital pattern. Sourced from `plans/for-your-doctor-design-brief.md`
// and the founder-approved Option A "The Cover Letter" mockup in
// the design canvas bundle. The PDF flow that used to live on
// Trends now lives here; Trends v2 only carries an inline link.
//
// Layout (top → bottom), per the design:
//   1. Header                — back chevron + "Leiko · Share" eyebrow
//   2. Title block           — "For your doctor." (italic on "doctor")
//                              + italic-serif cover-letter sub-line
//   3. Range label + chips   — segmented control style, locked chips
//                              for free users
//   4. Preview card          — DoctorCoverPreview thumbnail + page tag
//   5. Note field            — optional cover-page line (stretch in
//                              brief; included per the design landing)
//   6. Options block         — Include notes / Include caregiver comments
//   7. Generate CTA          — primary button. Free tap → paywall.
//
// State machine (per the brief §9):
//   default → user can tweak → generating → ok (share sheet opens)
//                                         → error → ErrorState
//   empty (no readings) → EmptyState; preview/options/CTA hidden
//   offline → globally banner; CTA error copy

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useTheme, type Theme } from '../../theme';
import {
  downloadDoctorPdf,
  pdfFileExists,
} from '../../services/doctorPdfFile';
import { useAuth } from '../../state/auth';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import { useTrendsData } from '../../hooks/useTrendsData';
import { usePlusEntitlement } from '../../hooks/usePlusEntitlement';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { Button } from '../../components/Button';
import { ListRow } from '../../components/ListRow';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { PaywallSheet } from '../../components/PaywallSheet';
import { DoctorCoverPreview } from '../../components/DoctorCoverPreview';
import { DoctorNoteField } from '../../components/DoctorNoteField';
import { ClinicalContextFields } from '../../components/ClinicalContextFields';
import { BaselineReference } from '../../components/BaselineReference';
import { ForYourDoctorRangeChipsRow } from './ForYourDoctorRangeChipsRow';
import {
  generateDoctorPdf,
  pdfRangeFromTrendsRange,
  projectedPageCount,
  type DoctorPdfRange,
  type DoctorPdfResult,
} from '../../services/doctorPdf';
import {
  readCoverNote,
  writeCoverNote,
  readLastGenerated,
  writeLastGenerated,
  formatLastGenerated,
  readMedications,
  writeMedications,
  readSymptoms,
  writeSymptoms,
  readTargetBp,
  writeTargetBp,
} from '../../services/doctorPdfState';
import { useReadings } from '../../state/readings';
import { bpBaseline, formatBPBaseline } from '../../utils/vitalBaselines';
import { logger } from '../../services/analytics/logger';
import type { AccountType } from '../../types/database';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';
import type {
  CaregiverScreenProps,
  SelfBuyerScreenProps,
} from '../../navigation/types';

// Strings — voice-lint tested at the bottom of this file's test.
//
// Sprint 16.5h — subtitle templates use a `{possessive}` placeholder
// instead of hardcoded "her" / "your" so the screen can interpolate
// the real parent's name in caregiver mode. The {range} placeholder
// is still substituted by the screen.
export const FYD_STRINGS = {
  eyebrow: 'Leiko · Share',
  subtitleTemplate:
    'A summary of {possessive} last {range} of readings, in a format {possessive_doctor} doctor can scan in a minute.',
  rangeEyebrow: 'Cover the last',
  pdfFootnote: 'Cover · Vitals · Cross-vital observations',
  optionIncludeNotes: 'Include notes',
  optionIncludeNotesSub: 'The lines you wrote on individual readings',
  optionIncludeComments: 'Include caregiver comments',
  optionIncludeCommentsSub: 'Anything you noted from your visits',
  generateLabel: 'Generate PDF',
  reShareLabel: 'Re-share most recent',
  generatingLabel: 'Putting your report together…',
  retryLabel: 'Try again',
  errorBody: "We couldn't put it together just now.",
  emptyTitle: 'No readings to share yet',
  emptyBody: "Take a few readings this week and they'll appear here.",
  offlineHint: 'We need a connection to put this together.',
  offlineCtaSub: "Offline · we'll generate this once you're back online.",
  plusUnlock: 'Plus unlocks 30 days and beyond',
  shareTargetHint: 'Opens your share sheet — mail, messages, files.',
  sandboxToast: 'Sandbox: HTML logged for the dev build.',
} as const;

type Phase = 'default' | 'generating' | 'error';

type Nav =
  | CaregiverScreenProps<'ForYourDoctor'>
  | SelfBuyerScreenProps<'ForYourDoctor'>
  | {
      navigation: { goBack: () => void };
      route?: { params?: { range?: string } };
    };

const RANGE_WORD: Record<DoctorPdfRange, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': 'year',
};

/**
 * Sprint 16.5h — subtitle composer. Pre-fix the caregiver template
 * hardcoded "her" three times in one sentence; now we interpolate
 * the real parent's name where the possessive used to be. Self-buyer
 * keeps "your".
 */
export function subtitleCopy(
  accountType: AccountType,
  range: DoctorPdfRange,
  parentLabel: string,
): string {
  if (accountType === 'caregiver') {
    // "A summary of Patricia's last 30 days of readings, ready for her
    //  next visit with the doctor." — uses the real name once + a
    // generic descriptor instead of three pronouns.
    return `A summary of ${parentLabel}'s last ${RANGE_WORD[range]} of readings, in a format the doctor can scan in a minute.`;
  }
  return FYD_STRINGS.subtitleTemplate
    .replace('{possessive}', 'your')
    .replace('{possessive_doctor}', 'your')
    .replace('{range}', RANGE_WORD[range]);
}

/**
 * Build the Share.share() payload. React Native's Share API is
 * platform-asymmetric:
 *   iOS    — reads `url` (preferred), `message`, `title`
 *   Android — reads `message` and `title` only; `url` is IGNORED
 * Pre-fix the Android share sheet was passing JUST the subtitle text
 * to the target app (no PDF link), so users saw the screen subtitle
 * arrive in WhatsApp/Mail instead of the PDF. Append the URL to the
 * message so Android targets get something actionable. iOS still uses
 * the `url` field, which gives a richer file-share affordance.
 *
 * This is a JS-only fix that ships in the next APK rebuild. A proper
 * "share the file directly" path needs expo-file-system + expo-sharing
 * (download to local cache, share local URI) — both are native modules
 * and require a fresh native build, deferred.
 */
export function buildSharePayload(
  url: string,
  accountType: AccountType,
  range: DoctorPdfRange,
  parentLabel: string,
): { url?: string; message: string } {
  const subtitle = subtitleCopy(accountType, range, parentLabel);
  if (Platform.OS === 'android') {
    // Android needs the URL inside `message` because Share.share
    // ignores the `url` field on this platform.
    return { message: `${subtitle}\n\n${url}` };
  }
  return { url, message: subtitle };
}

function dateRangeLabel(range: DoctorPdfRange, nowMs: number = Date.now()): string {
  const end = new Date(nowMs);
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const start = new Date(nowMs - (days - 1) * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    // Sprint 16.5i — device-locale-aware (was hardcoded 'en-US').
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const yearLabel = end.getFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${yearLabel}`;
}

export function ForYourDoctorScreen(props: Nav) {
  const theme = useTheme();
  const nav = props.navigation as {
    goBack: () => void;
    navigate: (route: string, params?: object) => void;
  };
  const initialRange = props.route?.params?.range as
    | DoctorPdfRange
    | 'all_time'
    | undefined;

  const profile = useAuth((s) => s.profile);
  const accountType: AccountType = profile?.account_type ?? 'self_buyer';

  const { isPlus } = usePlusEntitlement();
  const { parents } = useFamilyReadings();
  const familyId = parents[0]?.familyId ?? null;
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const networkStatus = useNetworkStatus();
  const isOffline = networkStatus.offline;

  // Sprint 16.5h — parent label resolution. In caregiver mode this is
  // the parent the caregiver is caring FOR (Patricia/John/etc), pulled
  // from the family membership. In self-buyer mode it's the user's own
  // display name. Pre-fix `preparedFor` defaulted to a literal real
  // person's name ("Adaeze Okeke") from the design bundle.
  const parentLabel = useMemo(() => {
    if (accountType !== 'caregiver') {
      return profile?.display_name?.trim() || 'You';
    }
    return parents[0]?.parentDisplayName?.trim() || 'your parent';
  }, [accountType, profile?.display_name, parents]);

  // `preparedFor` is the name that prints on the PDF cover. In
  // caregiver mode that's the parent's name; in self-buyer mode the
  // user's own. Empty string suppresses the line in the preview
  // (DoctorCoverPreview handles the no-name case).
  const preparedFor =
    accountType === 'caregiver'
      ? parents[0]?.parentDisplayName?.trim() || ''
      : profile?.display_name?.trim() || '';

  // Default range: 7d (free) or 30d (Plus); honour the deep-link
  // range carried from Trends when present.
  const defaultRange: DoctorPdfRange = isPlus ? '30d' : '7d';
  const [range, setRange] = useState<DoctorPdfRange>(
    pdfRangeFromTrendsRange(initialRange, defaultRange),
  );

  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  // Sprint 16.5h — note seeded from MMKV so a draft survives nav away.
  const [note, setNote] = useState<string>(() => readCoverNote());
  // Sprint 19 PDF v2 — structured clinical-context fields, same MMKV
  // pattern. Each persists independently so a partial draft survives.
  const [medications, setMedications] = useState<string>(() => readMedications());
  const [symptoms, setSymptoms] = useState<string>(() => readSymptoms());
  const [targetBp, setTargetBp] = useState<string>(() => readTargetBp());
  const [phase, setPhase] = useState<Phase>('default');
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [sandboxNotice, setSandboxNotice] = useState(false);
  // Last-generated snapshot — readLastGenerated returns null when none.
  const [lastGenerated, setLastGenerated] = useState(() => readLastGenerated());

  // Persist note draft on every change (debounce-free MMKV is fine here).
  useEffect(() => {
    writeCoverNote(note);
  }, [note]);
  useEffect(() => {
    writeMedications(medications);
  }, [medications]);
  useEffect(() => {
    writeSymptoms(symptoms);
  }, [symptoms]);
  useEffect(() => {
    writeTargetBp(targetBp);
  }, [targetBp]);

  const trends = useTrendsData(familyId, range);

  // Sprint 16.5h — multi-vital empty gate. Pre-fix this was BP-only:
  // a user with HR/SpO2/sleep/activity history but no BP saw the
  // empty state even though the PDF would still have meaningful
  // sections. Now any vital with ≥ 3 entries qualifies.
  const summary = trends.data?.summary;
  const hasAnyVitalData =
    !!summary &&
    (summary.bp.count >= 3 ||
      summary.hr.count >= 3 ||
      summary.spo2.count >= 3 ||
      summary.sleep.count >= 3 ||
      summary.activity.count >= 3);
  const isEmpty = !!trends.data && !hasAnyVitalData;

  const sparkline = useMemo(
    () => (trends.data?.series.bp ?? []).map((p) => p.sys),
    [trends.data],
  );

  // Sprint 16.5h — projected page count from real vital counts.
  // Pre-fix the screen showed a literal "8 pages" regardless.
  const pageCount = useMemo(() => {
    if (!summary) return 2;
    return projectedPageCount(
      {
        bp: summary.bp.count,
        hr: summary.hr.count,
        spo2: summary.spo2.count,
        sleep: summary.sleep.count,
        activity: summary.activity.count,
      },
      false, // hasCorrelations — wire correlations hook in a later pass
    );
  }, [summary]);
  const pagesPdfLabel = `${pageCount} pages · PDF`;

  // Sprint 16.5h — baseline reference for the BP band shown on the
  // preview + threaded into the PDF eventually. Local-readings-slice
  // 30-day p10–p90.
  const recentReadings = useReadings((s) => s.recent);
  const pendingReadings = useReadings((s) => s.pending);
  const baseline = useMemo(
    () => bpBaseline([...pendingReadings, ...recentReadings]),
    [pendingReadings, recentReadings],
  );
  const baselineBody = baseline ? formatBPBaseline(baseline) : '';

  const onRangeTap = useCallback(
    (next: DoctorPdfRange) => {
      if (next !== '7d' && !isPlus) {
        setPaywallVisible(true);
        return;
      }
      setRange(next);
    },
    [isPlus],
  );

  const onGenerate = useCallback(async () => {
    if (!isPlus) {
      setPaywallVisible(true);
      return;
    }
    if (isOffline) {
      // Surface the offline message without firing a request that
      // will 5xx. The CTA-disabled gate below should also block this
      // path; this is defence-in-depth.
      setPhase('error');
      return;
    }
    if (!familyId || !userId) {
      setPhase('error');
      return;
    }
    logger.track('doctor_pdf_requested', { range });
    setPhase('generating');
    const result: DoctorPdfResult = await generateDoctorPdf({
      familyId,
      userId,
      range,
      includeNotes,
      includeComments,
      coverNote: note,
      medications,
      symptoms,
      targetBp,
    });
    if (result.status === 'ok') {
      logger.track('doctor_pdf_generated', { bytes: result.bytes });
      // Sprint 16.5h — persist for the "Last generated" line.
      const info = {
        url: result.url,
        range,
        generatedAtMs: Date.now(),
        bytes: result.bytes,
      };
      // 2026-06-05 file-share fix: download the PDF and SHOW the document
      // (PdfPreview, which shares the actual file). The old behaviour
      // shared the signed URL as text — recipients got a link that
      // expired after 1 hour instead of the report.
      const downloaded = await downloadDoctorPdf(result.url, range);
      if (downloaded.status === 'ok') {
        const withFile = { ...info, fileUri: downloaded.uri };
        writeLastGenerated(withFile);
        setLastGenerated(withFile);
        nav.navigate('PdfPreview', {
          fileUri: downloaded.uri,
          title: `Doctor report · last ${RANGE_WORD[range]}`,
        });
      } else {
        // Download failed (e.g. flaky network right after generating) —
        // fall back to the legacy URL share rather than dead-ending.
        writeLastGenerated(info);
        setLastGenerated(info);
        try {
          await Share.share(buildSharePayload(result.url, accountType, range, parentLabel));
        } catch {
          // OS sheet dismissed — nothing to do.
        }
      }
      setPhase('default');
      return;
    }
    if (result.status === 'mock') {
      // Sprint 16.5h — surface a visible toast so the engineer knows
      // the sandbox path fired. Pre-fix the spinner just cleared with
      // no indication anything happened.
      logger.track('doctor_pdf_generated', { bytes: result.htmlBytes });
      setSandboxNotice(true);
      setPhase('default');
      return;
    }
    logger.track('doctor_pdf_failed', { reason: result.reason });
    setPhase('error');
  }, [
    accountType,
    familyId,
    userId,
    range,
    includeNotes,
    includeComments,
    note,
    medications,
    symptoms,
    targetBp,
    parentLabel,
    isPlus,
    isOffline,
  ]);

  // Sprint 16.5h — re-share path. Uses the cached URL from the most
  // recent generation. Supabase signed URLs typically expire after a
  // few minutes-to-hours; if the share fails, fall through to a fresh
  // generate.
  const onReShare = useCallback(async () => {
    if (!lastGenerated) return;
    // 2026-06-05 — prefer re-opening the downloaded document. The cache
    // may have been evicted (and the signed URL expires in 1 hour), so
    // anything else falls back to a fresh generate.
    if (lastGenerated.fileUri && pdfFileExists(lastGenerated.fileUri)) {
      nav.navigate('PdfPreview', {
        fileUri: lastGenerated.fileUri,
        title: `Doctor report · last ${RANGE_WORD[lastGenerated.range]}`,
      });
      return;
    }
    void onGenerate();
  }, [lastGenerated, onGenerate, nav]);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.warmBase }]}
      edges={['top', 'bottom']}
      testID="for-your-doctor-screen"
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: theme.spacing.xxxxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Header theme={theme} onBack={() => nav.goBack()} />

        <TitleBlock
          theme={theme}
          accountType={accountType}
          parentLabel={parentLabel}
          range={range}
        />

        {isEmpty ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <EmptyState
              title={FYD_STRINGS.emptyTitle}
              body={FYD_STRINGS.emptyBody}
              testID="fyd-empty"
            />
          </View>
        ) : (
          <>
            <View
              style={{
                marginTop: theme.spacing.xl,
                paddingHorizontal: theme.spacing.l,
              }}
              testID="fyd-range-block"
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: 9,
                  letterSpacing: 1.6,
                  textTransform: 'uppercase',
                  color: theme.colors.text.tertiary,
                  marginBottom: theme.spacing.s,
                }}
                testID="fyd-range-eyebrow"
              >
                {FYD_STRINGS.rangeEyebrow}
              </Text>
              <ForYourDoctorRangeChipsRow
                active={range}
                isPlus={isPlus}
                onRangeTap={onRangeTap}
              />
            </View>

            <View
              style={{
                marginHorizontal: theme.spacing.xxl,
                marginTop: theme.spacing.xl,
              }}
            >
              <DoctorCoverPreview
                preparedFor={preparedFor}
                rangeLabel={RANGE_WORD[range]}
                datesLabel={dateRangeLabel(range)}
                accountType={accountType}
                parentLabel={parentLabel}
                sparkline={sparkline}
                freeUser={!isPlus}
                testID="fyd-preview"
              />
              <View style={[styles.pagesPdfTag, { backgroundColor: theme.colors.surface.warmBase, borderColor: theme.colors.brand.primary }]}>
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: 9,
                    letterSpacing: 1.4,
                    textTransform: 'uppercase',
                    color: theme.colors.brand.primary,
                  }}
                  testID="fyd-pages-tag"
                >
                  {pagesPdfLabel}
                </Text>
              </View>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: theme.fontFamilies.numeric,
                  fontSize: 9.5,
                  letterSpacing: 1.4,
                  textTransform: 'uppercase',
                  color: theme.colors.text.tertiary,
                  textAlign: 'center',
                  marginTop: theme.spacing.s,
                }}
                testID="fyd-pdf-footnote"
              >
                {FYD_STRINGS.pdfFootnote}
              </Text>
            </View>

            {baselineBody ? (
              <BaselineReference
                body={baselineBody}
                caption={`over the last ${baseline?.sampleCount ?? 30} readings`}
                testID="fyd-baseline"
              />
            ) : null}

            <DoctorNoteField
              value={note}
              onChange={setNote}
              accountType={accountType}
              parentLabel={parentLabel}
              testID="fyd-note"
            />

            <ClinicalContextFields
              medications={medications}
              symptoms={symptoms}
              targetBp={targetBp}
              onChangeMedications={setMedications}
              onChangeSymptoms={setSymptoms}
              onChangeTargetBp={setTargetBp}
              accountType={accountType}
              parentLabel={parentLabel}
              testID="fyd-clinical"
            />

            <View
              style={{
                marginHorizontal: theme.spacing.l,
                marginTop: theme.spacing.xl,
                borderRadius: theme.radii.l,
                backgroundColor: theme.colors.surface.warmSubtle,
                borderColor: theme.colors.border.subtle,
                borderWidth: StyleSheet.hairlineWidth,
                overflow: 'hidden',
              }}
            >
              <ListRow
                variant="toggle"
                title={FYD_STRINGS.optionIncludeNotes}
                subtitle={FYD_STRINGS.optionIncludeNotesSub}
                switchValue={includeNotes}
                onSwitchChange={setIncludeNotes}
                showDivider={accountType === 'caregiver'}
                testID="fyd-include-notes"
              />
              {accountType === 'caregiver' ? (
                <ListRow
                  variant="toggle"
                  title={FYD_STRINGS.optionIncludeComments}
                  subtitle={FYD_STRINGS.optionIncludeCommentsSub}
                  switchValue={includeComments}
                  onSwitchChange={setIncludeComments}
                  showDivider={false}
                  testID="fyd-include-comments"
                />
              ) : null}
            </View>

            <View
              style={{
                marginHorizontal: theme.spacing.l,
                marginTop: theme.spacing.xl,
              }}
            >
              <Button
                variant="primary"
                onPress={() => {
                  void onGenerate();
                }}
                loading={phase === 'generating'}
                disabled={isPlus && isOffline}
                accessibilityHint={
                  isPlus
                    ? isOffline
                      ? 'Disabled while offline.'
                      : 'Generates the PDF and opens the share sheet.'
                    : 'Opens the Leiko Plus paywall.'
                }
                testID="fyd-generate"
              >
                {phase === 'generating'
                  ? FYD_STRINGS.generatingLabel
                  : phase === 'error'
                    ? FYD_STRINGS.retryLabel
                    : FYD_STRINGS.generateLabel}
              </Button>
              {/* Sub-caption under the CTA — varies by state. */}
              {(() => {
                if (!isPlus) {
                  return (
                    <Text
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={{
                        fontFamily: theme.fontFamilies.numeric,
                        fontSize: 9,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        color: theme.colors.brand.primary,
                        textAlign: 'center',
                        marginTop: theme.spacing.s,
                      }}
                      testID="fyd-plus-unlock"
                    >
                      {FYD_STRINGS.plusUnlock}
                    </Text>
                  );
                }
                if (isOffline) {
                  return (
                    <Text
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={{
                        fontFamily: theme.fontFamilies.numeric,
                        fontSize: 9,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        color: theme.colors.text.tertiary,
                        textAlign: 'center',
                        marginTop: theme.spacing.s,
                      }}
                      testID="fyd-offline-hint"
                    >
                      {FYD_STRINGS.offlineCtaSub}
                    </Text>
                  );
                }
                return (
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{
                      fontFamily: theme.fontFamilies.numeric,
                      fontSize: 9,
                      letterSpacing: 1.2,
                      textTransform: 'uppercase',
                      color: theme.colors.text.tertiary,
                      textAlign: 'center',
                      marginTop: theme.spacing.s,
                    }}
                    testID="fyd-share-hint"
                  >
                    {FYD_STRINGS.shareTargetHint}
                  </Text>
                );
              })()}

              {/* Sprint 16.5h — Last generated line + re-share. Only
                  shown when a previous successful generation exists,
                  and only when not currently generating. */}
              {lastGenerated && phase === 'default' ? (
                <Pressable
                  onPress={() => {
                    void onReShare();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatLastGenerated(lastGenerated) ?? 'Last generated'}. Tap to re-share.`}
                  hitSlop={6}
                  testID="fyd-last-generated"
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    marginTop: theme.spacing.m,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{
                      fontFamily: theme.fontFamilies.numeric,
                      fontSize: 11,
                      color: theme.colors.text.secondary,
                    }}
                  >
                    {formatLastGenerated(lastGenerated)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{
                      fontFamily: theme.fontFamilies.numeric,
                      fontSize: 11,
                      color: theme.colors.brand.primary,
                    }}
                  >
                    · {FYD_STRINGS.reShareLabel}
                  </Text>
                </Pressable>
              ) : null}

              {/* Sandbox indicator — replaces the silent no-op when
                  the dev rasterizer returns mock HTML. */}
              {sandboxNotice ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{
                    fontFamily: theme.fontFamilies.numeric,
                    fontSize: 10,
                    letterSpacing: 0.4,
                    color: theme.colors.text.tertiary,
                    textAlign: 'center',
                    marginTop: theme.spacing.s,
                  }}
                  testID="fyd-sandbox-toast"
                >
                  {FYD_STRINGS.sandboxToast}
                </Text>
              ) : null}

              {/* Consolidated error surface — single ErrorState, no
                  duplicate "Try again" affordance with the primary
                  button. The primary CTA above turns into the retry. */}
              {phase === 'error' ? (
                <View
                  style={{
                    marginTop: theme.spacing.m,
                  }}
                >
                  <ErrorState
                    title={FYD_STRINGS.errorBody}
                    body={
                      isOffline
                        ? FYD_STRINGS.offlineHint
                        : 'Tap the button above to try again.'
                    }
                    testID="fyd-error"
                  />
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      <PaywallSheet
        visible={paywallVisible}
        onDismiss={() => setPaywallVisible(false)}
        accountType={accountType}
        trigger="pdf_export"
      />
    </SafeAreaView>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function Header({ theme, onBack }: { theme: Theme; onBack: () => void }) {
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.l,
        paddingTop: theme.spacing.l,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: theme.spacing.m,
        }}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 16 }}
          style={{ flexDirection: 'row', alignItems: 'center' }}
          testID="fyd-back"
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke={theme.colors.text.secondary}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              color: theme.colors.text.secondary,
              marginLeft: 6,
            }}
          >
            Back
          </Text>
        </Pressable>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 9.5,
            letterSpacing: 2.0,
            textTransform: 'uppercase',
            color: theme.colors.brand.primary,
          }}
          testID="fyd-header-eyebrow"
        >
          {FYD_STRINGS.eyebrow}
        </Text>
      </View>
    </View>
  );
}

function TitleBlock({
  theme,
  accountType,
  parentLabel,
  range,
}: {
  theme: Theme;
  accountType: AccountType;
  parentLabel: string;
  range: DoctorPdfRange;
}) {
  // Sprint 16.5h — title now reads "For [Patricia]'s doctor." in
  // caregiver mode (was "For her doctor.") so the user sees the
  // actual parent's name. Self-buyer stays "For your doctor."
  const titleLead =
    accountType === 'caregiver'
      ? `For ${parentLabel}'s `
      : 'For your ';
  return (
    <View
      style={{
        paddingHorizontal: theme.spacing.l,
        paddingTop: theme.spacing.xs,
      }}
    >
      <Text
        accessibilityRole="header"
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: theme.fontFamilies.editorial,
          fontSize: 32,
          lineHeight: 34,
          color: theme.colors.text.primary,
          letterSpacing: -0.6,
        }}
        testID="fyd-title"
      >
        <Text>{titleLead}</Text>
        <Text
          style={{
            fontFamily: theme.fontFamilies.editorialItalic,
            fontStyle: 'italic',
            color: theme.colors.brand.primary,
          }}
        >
          doctor
        </Text>
        <Text>.</Text>
      </Text>
      <Text
        style={{
          marginTop: theme.spacing.s,
          fontFamily: theme.fontFamilies.editorialItalic,
          fontSize: 14,
          lineHeight: 20,
          color: theme.colors.text.secondary,
          fontStyle: 'italic',
        }}
        testID="fyd-subtitle"
      >
        {subtitleCopy(accountType, range, parentLabel)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 80 },
  pagesPdfTag: {
    position: 'absolute',
    top: -10,
    right: -8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
