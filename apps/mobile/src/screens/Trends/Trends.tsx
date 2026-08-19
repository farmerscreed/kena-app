// Trends v2 — "The Letter".
//
// Narrative-led redesign sourced from `plans/trends-v2-design-brief.md`
// and the founder-approved Option A "The Letter" mockup in the design
// canvas bundle. The screen flips the visual hierarchy from Trends v1:
//
//   1. Header                     (Back · brand eyebrow · "Your trends")
//   2. Range chips                (recessive, top of scroll)
//   3. Letter hero                (eyebrow + serif paragraph + freshness)
//   4. Evidence card              (focal vital — BP for v1.0 — chart)
//   5. Ask Leiko affordance       (calm pill, opens AskLeikoSheet)
//   6. Cited footnote rail        (numbered correlation cards)
//   7. See everything toggle      (chevron + label + thin rule)
//      └── Expansion panel        (range MultiVitalChart + toggles)
//   8. Weekly summary placeholder (dashed-border card)
//   9. Doctor inline link         (centred, soft underline)
//
// The doctor-PDF CTA from v1 is REMOVED. Trends v2 owns only the
// inline link in #9; the PDF flow lives on the new "For your doctor"
// screen (Sprint 16+ follow-up).
//
// Voice rules (docs/05-voice-and-claims.md): every authored string
// goes through `lintVoiceText` in the component tests. The dynamic
// narrative passes through `generateTrendsNarrative`, which itself
// composes voice-clean templates.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pill } from '../../components/Pill';
import {
  MultiVitalChart,
  type MultiVitalSeries,
} from '../../components/MultiVitalChart';
import { PaywallSheet, type PaywallTrigger } from '../../components/PaywallSheet';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { TrendsLetterHero } from '../../components/TrendsLetterHero';
import { TrendsEvidenceCard } from '../../components/TrendsEvidenceCard';
import { TrendsAskAffordance } from '../../components/TrendsAskAffordance';
import { TrendsCitedSection } from '../../components/TrendsCitedSection';
import { TrendsSeeEverythingToggle } from '../../components/TrendsSeeEverythingToggle';
import { TrendsWeeklySummaryCard } from '../../components/TrendsWeeklySummaryCard';
import { TrendsDoctorInlineLink } from '../../components/TrendsDoctorInlineLink';
import { AskLeikoSheet } from '../../components/AskLeikoSheet';
import { BaselineReference } from '../../components/BaselineReference';
import { Header } from './TrendsHeader';
import { TrendsRangeChipsRow } from './TrendsRangeChipsRow';
import {
  useTrendsCorrelations,
  useTrendsData,
  usePrefetchTrendsRange,
} from '../../hooks/useTrendsData';
import { usePlusEntitlement } from '../../hooks/usePlusEntitlement';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import { useAuth } from '../../state/auth';
import { useReadings } from '../../state/readings';
import { useTheme, type Theme } from '../../theme';
import { generateTrendsNarrative } from '../../services/ai/trendsNarration';
import type { TrendsRange, TrendsData } from '../../utils/trends-aggregate';
import type { VitalType } from '../../components/VitalRing';
import { ViewAsTableLink } from '../../components/ViewAsTableLink';
import { StorySection } from '../../components/StorySection';
import { mmkv, STORAGE_KEYS } from '../../services/storage';
import type { AccountType } from '../../types/database';
import { bpBaseline, formatBPBaseline } from '../../utils/vitalBaselines';
import type {
  CaregiverStackParamList,
  SelfBuyerStackParamList,
} from '../../navigation/types';

type AnyNav = NativeStackNavigationProp<
  CaregiverStackParamList | SelfBuyerStackParamList
>;

const FREE_RANGE: TrendsRange = '7d';
const RANGE_LABELS: Record<TrendsRange, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '1y': '1Y',
  all_time: 'All',
};
const RANGE_WORD: Record<TrendsRange, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': 'year',
  all_time: 'time on Leiko',
};

const ALL_VITALS: VitalType[] = ['bp', 'hr', 'spo2', 'sleep', 'activity'];
// Sprint 16.5g — all 5 vitals visible by default in the expansion now
// that hydration is wired end-to-end. Pre-fix, spo2 + activity were
// hidden by default, forcing the user to toggle them on every time.
const DEFAULT_VISIBLE: Record<VitalType, boolean> = {
  bp: true,
  hr: true,
  spo2: true,
  sleep: true,
  activity: true,
};
const VITAL_CHIP_LABEL: Record<VitalType, string> = {
  bp: 'BP',
  hr: 'HR',
  spo2: 'SpO2',
  sleep: 'Sleep',
  activity: 'Activity',
};

const FOCAL_VITAL_TITLE: Record<VitalType, string> = {
  bp: 'Blood pressure · morning',
  hr: 'Heart rate · resting',
  spo2: 'Oxygen · overnight',
  sleep: 'Sleep · last 7 nights',
  activity: 'Steps · this range',
};

interface PaywallState {
  visible: boolean;
  trigger: PaywallTrigger;
}

// ─── Freshness formatting ─────────────────────────────────────────────

function formatFreshness(computedAtMs: number, nowMs: number): string {
  const ageMs = Math.max(0, nowMs - computedAtMs);
  const m = Math.round(ageMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return 'last week';
}

/** Pull the latest value + range bounds for the focal vital so the
 *  evidence card adapts dynamically (was hardcoded BP-only). Returns
 *  the data the card needs in one go. */
function evidenceFor(
  vital: VitalType,
  data: TrendsData | undefined,
): {
  latestValue: string;
  series: number[];
  yRange: [number, number];
  axisStart: string;
  axisEnd: string;
} {
  const fallback = {
    latestValue: '—',
    series: [] as number[],
    yRange: [0, 1] as [number, number],
    axisStart: '',
    axisEnd: '',
  };
  if (!data) return fallback;
  switch (vital) {
    case 'bp': {
      const series = data.series.bp;
      if (series.length === 0) return fallback;
      const sys = series.map((p) => p.sys);
      const dia = series.map((p) => p.dia);
      const last = series[series.length - 1];
      const yMin = Math.max(60, Math.floor((Math.min(...sys, ...dia) - 5) / 5) * 5);
      const yMax = Math.min(220, Math.ceil((Math.max(...sys) + 5) / 5) * 5);
      return {
        latestValue: `${Math.round(last.sys)}/${Math.round(last.dia)}`,
        series: sys,
        yRange: [yMin, yMax],
        axisStart: series[0].day,
        axisEnd: last.day,
      };
    }
    case 'hr': {
      const series = data.series.hr.filter((p) => p.restingBpm !== null);
      if (series.length === 0) return fallback;
      const vals = series.map((p) => p.restingBpm as number);
      const last = series[series.length - 1];
      const yMin = Math.max(40, Math.floor((Math.min(...vals) - 5) / 5) * 5);
      const yMax = Math.min(180, Math.ceil((Math.max(...vals) + 5) / 5) * 5);
      return {
        latestValue: `${Math.round(last.restingBpm as number)}`,
        series: vals,
        yRange: [yMin, yMax],
        axisStart: series[0].day,
        axisEnd: last.day,
      };
    }
    case 'spo2': {
      const series = data.series.spo2.filter((p) => p.avgPercent !== null);
      if (series.length === 0) return fallback;
      const vals = series.map((p) => p.avgPercent as number);
      const last = series[series.length - 1];
      const yMin = Math.max(80, Math.floor(Math.min(...vals) - 3));
      return {
        latestValue: `${Math.round(last.avgPercent as number)}%`,
        series: vals,
        yRange: [yMin, 100],
        axisStart: series[0].day,
        axisEnd: last.day,
      };
    }
    case 'sleep': {
      const series = data.series.sleep;
      if (series.length === 0) return fallback;
      const vals = series.map((p) => p.totalMinutes);
      const last = series[series.length - 1];
      const h = Math.floor(last.totalMinutes / 60);
      const m = last.totalMinutes % 60;
      return {
        latestValue: `${h}h ${m}m`,
        series: vals,
        yRange: [
          Math.max(0, Math.floor((Math.min(...vals) - 30) / 30) * 30),
          Math.ceil((Math.max(...vals) + 30) / 30) * 30,
        ],
        axisStart: series[0].day,
        axisEnd: last.day,
      };
    }
    case 'activity': {
      const series = data.series.activity;
      if (series.length === 0) return fallback;
      const vals = series.map((p) => p.totalSteps);
      const last = series[series.length - 1];
      return {
        latestValue: `${Math.round(last.totalSteps).toLocaleString()}`,
        series: vals,
        yRange: [0, Math.ceil((Math.max(...vals) + 1000) / 1000) * 1000],
        axisStart: series[0].day,
        axisEnd: last.day,
      };
    }
  }
}

// ─── Screen ───────────────────────────────────────────────────────────

export function Trends() {
  const theme = useTheme();
  const navigation = useNavigation<AnyNav>();
  const profile = useAuth((s) => s.profile);
  const accountType: AccountType = profile?.account_type ?? 'caregiver';

  const { parents, isRefreshing, refresh } = useFamilyReadings();
  const familyId = parents[0]?.familyId ?? null;
  const userId = useAuth((s) => s.session?.user.id ?? null);

  // Sprint 16.5g — caregiver-mode parent label comes from the family
  // membership (the actual parent's display name), NOT the caregiver's
  // profile. Pre-fix `profile?.display_name ?? 'Mum'` was always the
  // caregiver's name, so narratives like "John's mornings averaged 145"
  // referred to the caregiver, not the parent being cared for.
  const parentLabel = useMemo(() => {
    if (accountType !== 'caregiver') {
      return profile?.display_name?.trim() || 'You';
    }
    const parentName = parents[0]?.parentDisplayName?.trim();
    return parentName || 'Mum';
  }, [accountType, profile?.display_name, parents]);

  const [range, setRange] = useState<TrendsRange>(FREE_RANGE);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState<Record<VitalType, boolean>>(
    () => ({ ...DEFAULT_VISIBLE }),
  );
  const [paywall, setPaywall] = useState<PaywallState>({
    visible: false,
    trigger: 'range_extension',
  });
  const [askVisible, setAskVisible] = useState(false);

  const { isPlus } = usePlusEntitlement();
  // Wearer's tz drives the RPC's day bucketing (ADR-0008 D3). Trends is
  // always the signed-in user's own circle on this route, so their
  // profile tz IS the wearer tz.
  const wearerTz = useAuth((s) => s.profile?.timezone ?? null);
  const trends = useTrendsData(familyId, range, { timeZone: wearerTz });
  const correlations = useTrendsCorrelations(familyId, userId);

  // Sprint 16.5g — prefetch 30D for Plus users so first tap is instant.
  // No-op for free users (would just trigger the paywall anyway).
  usePrefetchTrendsRange(isPlus && range === '7d' ? familyId : null, '30d', {
    timeZone: wearerTz,
  });

  // Sprint 16.5g — baseline computed from the readings slice (the
  // 30-day p10–p90 band). Surfaced under the focal chart so "within
  // your range" finally has a visible range.
  const recentReadings = useReadings((s) => s.recent);
  const pendingReadings = useReadings((s) => s.pending);
  const baselineBP = useMemo(
    () => bpBaseline([...pendingReadings, ...recentReadings]),
    [pendingReadings, recentReadings],
  );

  // Narrative — Tier-C engine (rich deterministic) via the cascade.
  // Refetches when range / data / correlations change. The cascade
  // guarantees a non-null body.
  //
  // Sprint 16.5g — freshness caption used to lie by setting
  // `computedAtMs: Date.now()` on every effect. Now we track the
  // tuple of inputs and only update the timestamp when the
  // narrative content actually changes.
  const [narrative, setNarrative] = useState<{
    body: string;
    focalVital: VitalType;
    citedDayIdx: number | null;
    signOff: string;
    tier: 'C' | 'A' | 'deterministic';
    computedAtMs: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void generateTrendsNarrative({
      data: trends.data,
      correlations: correlations.correlations,
      range,
      accountType,
      parentLabel,
      baselines: { bp: baselineBP ?? null },
    }).then((r) => {
      if (cancelled) return;
      setNarrative((prev) => {
        // Preserve the computed timestamp when the body hasn't
        // actually changed (re-renders shouldn't make "just now"
        // appear forever).
        if (prev && prev.body === r.body) return prev;
        return {
          body: r.body,
          focalVital: r.focalVital,
          citedDayIdx: r.citedDayIdx,
          signOff: r.signOff,
          tier: r.tier,
          computedAtMs: Date.now(),
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    trends.data,
    correlations.correlations,
    range,
    accountType,
    parentLabel,
    baselineBP,
  ]);

  const onRangeTap = useCallback(
    (next: TrendsRange) => {
      if (next !== FREE_RANGE && !isPlus) {
        const trigger: PaywallTrigger =
          next === 'all_time' ? 'all_time_range' : 'range_extension';
        setPaywall({ visible: true, trigger });
        return;
      }
      setRange(next);
    },
    [isPlus],
  );

  const onVitalToggle = useCallback((kind: VitalType) => {
    setVisible((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }, []);

  const dismissPaywall = useCallback(
    () => setPaywall((prev) => ({ ...prev, visible: false })),
    [],
  );

  // Sprint 16.5g — opens AskLeikoSheet with the current range +
  // focal vital pre-loaded as context. Pre-fix this was a no-op
  // (visible CTA, no effect). The sheet does the Tier-B call.
  const onAskTrend = useCallback(() => {
    setAskVisible(true);
  }, []);

  const onOpenDoctorScreen = useCallback(() => {
    // Deep-link to "For your doctor" with the current Trends range
    // pre-selected. "all_time" doesn't have a PDF analogue; the
    // doctor screen's `pdfRangeFromTrendsRange` falls back when
    // necessary. The cast satisfies both stacks' type unions.
    (navigation as unknown as {
      navigate: (screen: 'ForYourDoctor', params?: { range?: TrendsRange }) => void;
    }).navigate('ForYourDoctor', { range });
  }, [navigation, range]);

  const series = useMemo<MultiVitalSeries[]>(
    () => buildSeries(trends.data, visible),
    [trends.data, visible],
  );

  // Sprint 16.5g — multi-vital empty gate. Pre-fix this was BP-only,
  // so a user with full HR/SpO2/sleep/activity history but < 3 BP
  // readings saw "Trends will appear here next week" forever.
  const summary = trends.data?.summary;
  const hasAnyVitalData = !!summary && (
    summary.bp.count >= 3 ||
    summary.hr.count >= 3 ||
    summary.spo2.count >= 3 ||
    summary.sleep.count >= 3 ||
    summary.activity.count >= 3
  );

  const headerTitle = accountType === 'self_buyer' ? 'Your trends' : 'Trends';
  const eyebrow = `A letter from Leiko · ${RANGE_WORD[range]}`;
  const freshnessCaption = narrative
    ? `Last computed ${formatFreshness(narrative.computedAtMs, Date.now())}`
    : undefined;

  // Focal vital + evidence card data (16.5g — was hardcoded BP).
  // Focal-vital switcher (founder-approved package B, 2026-06-05): the
  // narrative still nominates a focal vital, but the user can override
  // it to see any vital's range trend in the evidence card.
  const [focalOverride, setFocalOverride] = useState<VitalType | null>(null);
  const focalVital: VitalType = focalOverride ?? narrative?.focalVital ?? 'bp';
  const evidence = useMemo(
    () => evidenceFor(focalVital, trends.data),
    [focalVital, trends.data],
  );
  const focalBPBand = focalVital === 'bp' && baselineBP
    ? ([baselineBP.sysLow, baselineBP.sysHigh] as [number, number])
    : focalVital === 'bp'
      ? ([110, 130] as [number, number])
      : undefined;
  const baselineBody = baselineBP ? formatBPBaseline(baselineBP) : '';

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: theme.colors.surface.warmBase },
      ]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: theme.spacing.xxxxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={theme.colors.brand.coral}
          />
        }
        testID="trends-scroll"
      >
        <Header title={headerTitle} onBack={() => navigation.goBack()} />

        {/* Story Trends (2026-08-19) — the person's arc sits above the
            range machinery: letter, band river, chapters. */}
        <StorySection
          familyId={familyId ?? mmkv.getString(STORAGE_KEYS.currentFamilyId) ?? null}
          userId={userId}
        />

        <TrendsRangeChipsRow
          accountType={accountType}
          active={range}
          isPlus={isPlus}
          onRangeTap={onRangeTap}
        />

        {trends.isLoading && !narrative ? (
          <LoadingState
            caption="Reading the last few weeks."
            testID="trends-loading"
            style={{ marginTop: theme.spacing.xl }}
          />
        ) : trends.error ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <ErrorState
              onRetry={refresh}
              testID="trends-error"
              title="We couldn't read your trends just now."
              body="Pull to refresh, or try again in a moment."
            />
          </View>
        ) : !hasAnyVitalData ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <EmptyState
              title="Trends will appear here next week"
              body="We need a few days of readings before we can show a pattern."
              testID="trends-empty"
            />
          </View>
        ) : (
          <>
            <TrendsLetterHero
              body={narrative?.body ?? ''}
              eyebrow={eyebrow}
              freshnessCaption={freshnessCaption}
              signOff={narrative?.signOff}
              testID="trends-letter"
            />

            <View
              style={{
                marginTop: theme.spacing.l,
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: theme.spacing.s,
              }}
              testID="trends-focal-chips"
            >
              {ALL_VITALS.map((v) => {
                const active = v === focalVital;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setFocalOverride(v)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Show ${VITAL_CHIP_LABEL[v]} trend`}
                    testID={`trends-focal-${v}`}
                    style={{
                      paddingHorizontal: theme.spacing.m,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.radii.full,
                      borderWidth: 1,
                      borderColor: active
                        ? theme.colors.brand.primary
                        : theme.colors.border.subtle,
                    }}
                  >
                    <Text
                      style={{
                        color: active
                          ? theme.colors.brand.primary
                          : theme.colors.text.secondary,
                        fontSize: theme.type('caption').size,
                        fontFamily: theme.type('caption').family,
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {VITAL_CHIP_LABEL[v]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: theme.spacing.s }}>
              <TrendsEvidenceCard
                vital={focalVital}
                title={FOCAL_VITAL_TITLE[focalVital]}
                latestValue={evidence.latestValue}
                series={evidence.series}
                yRange={evidence.yRange}
                healthyBand={focalBPBand}
                annotation={
                  narrative?.citedDayIdx !== null &&
                  narrative?.citedDayIdx !== undefined
                    ? { index: narrative.citedDayIdx, label: 'Cited' }
                    : undefined
                }
                axisStart={evidence.axisStart}
                axisEnd={evidence.axisEnd}
                testID="trends-evidence"
              />
            </View>

            {focalVital === 'bp' && baselineBody ? (
              <BaselineReference
                body={baselineBody}
                caption={`over the last ${baselineBP?.sampleCount ?? 30} readings`}
                style={{ marginTop: theme.spacing.s }}
                testID="trends-baseline"
              />
            ) : null}

            <View style={{ marginTop: theme.spacing.m }}>
              <TrendsAskAffordance
                onPress={onAskTrend}
                testID="trends-ask"
              />
            </View>

            <TrendsCitedSection
              rows={correlations.correlations}
              testID="trends-cited"
              onSelectRow={(corrRow) => {
                // Sprint 16.5g — tapping a correlation card deep-links
                // to the relevant detail screen.
                const target = corrRow.correlation_type === 'sleep_x_morning_bp'
                  ? 'bp'
                  : corrRow.correlation_type === 'activity_x_resting_hr'
                    ? 'hr'
                    : 'spo2';
                (navigation as unknown as {
                  navigate: (screen: 'VitalDetail', params: { vital: VitalType }) => void;
                }).navigate('VitalDetail', { vital: target });
              }}
            />

            <TrendsSeeEverythingToggle
              open={expanded}
              onToggle={() => setExpanded((v) => !v)}
              testID="trends-see-everything"
            />
            {expanded ? (
              <ExpansionPanel
                theme={theme}
                series={series}
                visible={visible}
                onToggle={onVitalToggle}
                rangeLabel={RANGE_LABELS[range]}
              />
            ) : null}

            <TrendsWeeklySummaryCard
              data={trends.data}
              correlations={correlations.correlations}
              accountType={accountType}
              parentLabel={parentLabel}
              baselineBP={baselineBP}
              testID="trends-weekly-summary"
            />
          </>
        )}

        <TrendsDoctorInlineLink
          accountType={accountType}
          onPress={onOpenDoctorScreen}
          testID="trends-doctor-link"
        />
      </ScrollView>

      <PaywallSheet
        visible={paywall.visible}
        onDismiss={dismissPaywall}
        accountType={accountType}
        trigger={paywall.trigger}
      />

      <AskLeikoSheet
        visible={askVisible}
        onDismiss={() => setAskVisible(false)}
        onArticleOpen={(id) =>
          (navigation as unknown as {
            navigate: (s: 'Article', p: { articleId: string }) => void;
          }).navigate('Article', { articleId: id })
        }
      />
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components (16.5g — Header + RangeChipsRow extracted to siblings).

function ExpansionPanel({
  theme,
  series,
  visible,
  onToggle,
  rangeLabel,
}: {
  theme: Theme;
  series: MultiVitalSeries[];
  visible: Record<VitalType, boolean>;
  onToggle: (kind: VitalType) => void;
  rangeLabel: string;
}) {
  return (
    <View
      style={{
        marginHorizontal: theme.spacing.l,
        marginTop: theme.spacing.m,
        padding: theme.spacing.m,
        borderRadius: theme.radii.l,
        backgroundColor: theme.colors.surface.warmElevated,
        borderColor: theme.colors.border.subtle,
        borderWidth: StyleSheet.hairlineWidth,
      }}
      testID="trends-expansion"
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: theme.spacing.xs,
          marginBottom: theme.spacing.m,
        }}
      >
        {ALL_VITALS.map((v) => (
          <Pill
            key={v}
            variant={visible[v] ? 'accent' : 'outline'}
            selected={visible[v]}
            onPress={() => onToggle(v)}
            testID={`trends-toggle:${v}`}
          >
            {VITAL_CHIP_LABEL[v]}
          </Pill>
        ))}
      </View>

      <MultiVitalChart
        series={series}
        caption="This range"
        subCaption={rangeLabel}
        testID="trends-chart"
      />
      {/* D13 PR-6 (§6.3/§9.1) — the non-visual route to the chart's
          numbers. Trends previously had none at all. */}
      <ViewAsTableLink
        rows={series
          .filter((s) => s.visible)
          .flatMap((s) =>
            s.values.map((v, i) => ({
              label: `${s.kind.toUpperCase()} · ${s.days[i] ?? ''}`,
              value: String(Math.round(v)),
            })),
          )}
        subjectNoun="daily values"
        testID="trends-table"
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers.

function buildSeries(
  data: ReturnType<typeof useTrendsData>['data'],
  visible: Record<VitalType, boolean>,
): MultiVitalSeries[] {
  if (!data) {
    return ALL_VITALS.map((kind) => ({
      kind,
      visible: visible[kind],
      values: [],
      days: [],
    }));
  }
  const bp = {
    kind: 'bp' as const,
    visible: visible.bp,
    values: data.series.bp.map((p) => p.sys),
    days: data.series.bp.map((p) => p.day),
  };
  const hr = {
    kind: 'hr' as const,
    visible: visible.hr,
    values: data.series.hr
      .map((p) => p.restingBpm)
      .filter((v): v is number => v !== null),
    days: data.series.hr
      .filter((p) => p.restingBpm !== null)
      .map((p) => p.day),
  };
  const spo2 = {
    kind: 'spo2' as const,
    visible: visible.spo2,
    values: data.series.spo2
      .map((p) => p.avgPercent)
      .filter((v): v is number => v !== null),
    days: data.series.spo2
      .filter((p) => p.avgPercent !== null)
      .map((p) => p.day),
  };
  const sleep = {
    kind: 'sleep' as const,
    visible: visible.sleep,
    values: data.series.sleep.map((p) => p.totalMinutes),
    days: data.series.sleep.map((p) => p.day),
  };
  const activity = {
    kind: 'activity' as const,
    visible: visible.activity,
    values: data.series.activity.map((p) => p.totalSteps),
    days: data.series.activity.map((p) => p.day),
  };
  return [bp, hr, spo2, sleep, activity];
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 80 },
});
