// ParentDashboard — Sprint 17a.
//
// Replaces the Sprint 7 `ParentReadingsList` placeholder. When a
// caregiver taps a parent's orb (or PersonCard) on the constellation
// Home, they now land here — the same Daily-Pulse-style immersive
// surface a self-buyer sees on their own Home, but family-scoped to
// the tapped parent's `familyId`.
//
// Composition mirrors `SelfBuyerHome.tsx`:
//   1. PulseHeader — eyebrow date + "Checking in on {parentName}" +
//      back chevron (replaces the self-buyer's settings avatar).
//   2. SyncReassuranceBanner + ScreenAnomalyBanner.
//   3. Local AnomalyBanner derived from the parent's BP classification.
//   4. DailyPulseHero — adaptive central + 5 ring satellites.
//   5. Narration card — STATIC PLACEHOLDER for v1 (Tier-A narration is
//      first-person-singleton-scoped; parent-scoped wiring is a
//      follow-up — see sprint card decision §7).
//   6. HomeLearnCard — same general health-literacy slot. Not
//      parent-data-scoped.
//   7. Vital tile strip — 5 tiles, tap → VitalDetail{vital, familyId}.
//   8. CorrelationStrip — sleep × resting HR.
//   9. DaySpine — derived from the parent's data.
//
// NOT mounted (vs. SelfBuyerHome): SelfBuyerTabBar, AskLeikoFAB,
// TakeReadingFAB, HealthPlatformPermissionPrompt, SixthReadingPaywallHost.
// Settings stays on CaregiverHome's gear icon; the caregiver doesn't
// take the parent's readings on this phone; Ask Leiko is OFF until
// the Tier-A intent router gets parent-scoped support; the paywall is
// already mounted at the family level on CaregiverHome.
//
// Realtime: inserts into `readings` or `vitals_other` for this
// `familyId` invalidate the `['parent-pulse', familyId]` query cache,
// re-fetching the dashboard's data without a manual refresh.
//
// Voice rules (docs/05-voice-and-claims.md): every user-visible string
// in this file is caregiver-POV — "Mum" / "Dad" / "{parentName}",
// never "patient" / "diagnose" / "predict" / "dangerous" / "critical"
// / "silent killer". The hardcoded "her" pronoun trap from the 16.5
// retro is avoided by using `parentDisplayName` directly.

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sleepScoreForSession } from '../../utils/classification';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AnomalyBanner } from '../../components/AnomalyBanner';
import { ScreenAnomalyBanner } from '../../components/ScreenAnomalyBanner';
import { SyncReassuranceBanner } from '../../components/SyncReassuranceBanner';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { DailyPulseHero } from '../../components/DailyPulseHero';
import { HomeLearnCard } from '../../components/HomeLearnCard';
import { VitalTile } from '../../components/VitalTile';
import {
  CorrelationStrip,
  type VitalSeries,
} from '../../components/CorrelationStrip';
import { DaySpine } from '../../components/DaySpine';
import { useSeededLearnCard } from '../../hooks/useSeededLearnCard';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import {
  useParentDailyPulseData,
  parentPulseQueryKey,
} from '../../hooks/useParentDailyPulseData';
import { useParentVitalsRecent } from '../../hooks/useParentVitalsRecent';
import { emptyDailyPulse } from '../../state/dailyPulse';
import { requestRemoteRefresh } from '../../services/sync/requestRemoteRefresh';
import {
  useRemoteRefreshNudge,
  type RemoteRefreshNudgeState,
} from './useRemoteRefreshNudge';
import { supabase } from '../../services/supabase';
import { useTheme, type Theme } from '../../theme';
import {
  buildHeroVitals,
  buildCentralSub,
  buildCentralUnit,
} from './SelfBuyerHome';
import {
  deriveDayMoments,
  pickCentralValue,
  type DayMoment,
} from '../../utils/dayMoments';
import type { CaregiverStackParamList } from '../../navigation/types';
import type { ParentSummary } from '../../services/families/fetchParentSummaries';
import type { DailyPulseData } from '../../state/dailyPulse';
import type { HRSample, SleepSession } from '../../types/vitals';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';

type Nav = NativeStackNavigationProp<CaregiverStackParamList>;
type Route = RouteProp<CaregiverStackParamList, 'ParentDashboard'>;

const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;

export function ParentDashboard() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { familyId } = route.params;

  // Parent identity (display name, relationship, age) comes from the
  // family-readings cache which CaregiverHome already keeps warm.
  const { parents, refresh: refreshFamily } = useFamilyReadings();
  const parent = useMemo<ParentSummary | null>(
    () => parents.find((p) => p.familyId === familyId) ?? null,
    [parents, familyId],
  );

  // Parent-scoped data (query-only, no MMKV, no singleton writes).
  const parentPulse = useParentDailyPulseData(familyId);
  const parentRecent = useParentVitalsRecent(familyId);
  const emptyFallback = useMemo(() => emptyDailyPulse(), []);
  const data: DailyPulseData = parentPulse.data ?? emptyFallback;

  // Sprint 18 — distinguish loading + error from "truly empty" so the
  // caregiver isn't told their parent has no data while the initial
  // fetch is still in flight or has errored. Matches the pattern used
  // by all 5 VitalDetail screens. The 30s staleTime on the query means
  // these branches mostly only fire on first mount / cold refresh.
  const isInitialLoad =
    (parentPulse.isLoading || parentRecent.isLoading) &&
    parentPulse.data === null;
  const loadError = parentPulse.error ?? parentRecent.error ?? null;

  // Fresh-data signal — bumped on every readings / vitals_other INSERT for
  // this family. The remote-refresh nudge hook watches it to tell whether a
  // silent sync actually surfaced new data (see useRemoteRefreshNudge).
  const [freshDataSignal, setFreshDataSignal] = useState(0);

  // Realtime — one subscription per (table, family). INSERTs invalidate
  // the parent-pulse cache key; TanStack Query re-fetches on the next
  // observer tick. `useId()` gives a stable per-instance channel suffix
  // so re-mounts / hot-reloads don't collide with previous subscriptions.
  const queryClient = useQueryClient();
  const subscriberId = useId();
  useEffect(() => {
    const channels = [
      supabase
        .channel(
          `parent-dashboard:readings:${familyId}:${subscriberId}`,
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'readings',
            filter: `family_id=eq.${familyId}`,
          },
          () => {
            void queryClient.invalidateQueries({
              queryKey: parentPulseQueryKey(familyId),
            });
            setFreshDataSignal((n) => n + 1);
          },
        )
        .subscribe(),
      supabase
        .channel(
          `parent-dashboard:vitals_other:${familyId}:${subscriberId}`,
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'vitals_other',
            filter: `family_id=eq.${familyId}`,
          },
          () => {
            void queryClient.invalidateQueries({
              queryKey: parentPulseQueryKey(familyId),
            });
            setFreshDataSignal((n) => n + 1);
          },
        )
        .subscribe(),
    ];
    return () => {
      for (const ch of channels) void supabase.removeChannel(ch);
    };
  }, [familyId, subscriberId, queryClient]);

  // ----- Hero composition (mirrors SelfBuyerHome) ---------------------
  const central = useMemo(() => pickCentralValue(data), [data]);
  const heroVitals = useMemo(() => buildHeroVitals(data), [data]);

  // ----- Anomaly banner — parent-flavored copy ------------------------
  const banner = useMemo(
    () => deriveParentBanner(data, parent),
    [data, parent],
  );

  // ----- Sleep × resting HR correlation -------------------------------
  const correlation = useMemo(
    () =>
      buildParentCorrelation(parentRecent.data.sleep, parentRecent.data.hr),
    [parentRecent.data.sleep, parentRecent.data.hr],
  );

  // ----- DaySpine moments ---------------------------------------------
  const moments = useMemo(() => deriveDayMoments(data), [data]);

  // ----- Learn card (general; not parent-data-scoped) -----------------
  const seededLearn = useSeededLearnCard();

  // ----- Header strings ------------------------------------------------
  const headerText = useMemo(() => buildParentHeader(parent), [parent]);

  // ----- Navigation handlers ------------------------------------------
  const handleHeroPress = useCallback(() => {
    navigation.navigate('VitalDetail', { vital: 'bp', familyId });
  }, [navigation, familyId]);

  const handleVitalPress = useCallback(
    (vital: 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity') => {
      navigation.navigate('VitalDetail', { vital, familyId });
    },
    [navigation, familyId],
  );

  const handleMomentPress = useCallback(
    (m: DayMoment) => handleVitalPress(m.vital),
    [handleVitalPress],
  );

  // Silent-first remote refresh + human-confirmed visible fallback. If the
  // silent sync below doesn't surface fresh data within the wait window, the
  // hook flips to 'offer' and we show the caregiver a calm "Send a reminder"
  // row (the only path that ever interrupts the wearer).
  const nudge = useRemoteRefreshNudge({ familyId, freshDataSignal });

  const handleRefresh = useCallback(async () => {
    // Ask the watch-owner's phone to pull fresh data from the watch right
    // now (SILENT push → background BLE sync). Fire-and-forget: the synced
    // readings arrive here via the Realtime subscription above, not via
    // this await. `beginWaiting()` starts watching for them. Then re-read
    // what's already on the server so the pull feels responsive immediately.
    void requestRemoteRefresh(familyId);
    nudge.beginWaiting();
    void refreshFamily();
    await parentPulse.refresh();
  }, [refreshFamily, parentPulse, familyId, nudge]);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.warmBase }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: theme.spacing.xxxxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={parentPulse.isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.brand.coral}
          />
        }
        testID="parent-dashboard-scroll"
      >
        <PulseHeader
          theme={theme}
          eyebrow={headerText.date}
          parentName={headerText.parentName}
          onBack={() => navigation.goBack()}
        />

        <SyncReassuranceBanner testID="parent-dashboard-sync-reassurance" />

        {/* Silent-first remote refresh: only shown if a silent sync didn't
            surface fresh data — the caregiver chooses whether to nudge. */}
        <RemoteRefreshNudgeRow
          theme={theme}
          parentName={headerText.parentName}
          state={nudge.state}
          onSend={nudge.sendReminder}
        />

        {/* Sprint 18 — distinguish loading + error from "truly empty"
            so the caregiver isn't told their parent has no data while
            we're still fetching or just errored. The header + sync
            reassurance banner above stay visible so the persona
            context is consistent across both branches. Body resumes
            in the else branch below. */}
        {isInitialLoad ? (
          <LoadingState
            caption={`Loading ${headerText.parentName}'s data…`}
            testID="parent-dashboard-loading"
            style={{ marginTop: theme.spacing.xl }}
          />
        ) : loadError ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <ErrorState
              onRetry={handleRefresh}
              testID="parent-dashboard-error"
            />
          </View>
        ) : (
        <>
        <View
          style={{
            paddingHorizontal: theme.spacing.l,
            marginTop: theme.spacing.l,
          }}
        >
          <ScreenAnomalyBanner />
        </View>

        {banner ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.l,
              marginTop: theme.spacing.l,
            }}
          >
            <AnomalyBanner
              severity={banner.severity}
              title={banner.title}
              body={banner.body}
              testID="parent-dashboard-anomaly-banner"
            />
          </View>
        ) : null}

        <Pressable
          onPress={handleHeroPress}
          accessibilityRole={data.bp.latest ? 'button' : 'text'}
          accessibilityHint={
            data.bp.latest
              ? `Opens ${headerText.parentName}'s blood pressure detail`
              : undefined
          }
          style={{
            marginTop: theme.spacing.xxl,
            alignItems: 'center',
          }}
          testID="parent-dashboard-hero-pressable"
        >
          <DailyPulseHero
            vitals={heroVitals}
            central={{
              label:
                central.priority === 'bp' ? 'Blood pressure' : central.label,
              value: central.value,
              sub: buildCentralSub(data, central.priority),
              unit: buildCentralUnit(central.priority),
              // Sprint 19 (audit P1-5) — same tier `deriveParentBanner`
              // reads below; it never reached the hero value itself.
              // Only meaningful when the cascade resolved to BP.
              tier:
                central.priority === 'bp'
                  ? data.bp.classification?.tier ?? null
                  : null,
              live: false,
            }}
            onSelectVital={handleVitalPress}
            testID="parent-dashboard-hero"
          />
        </Pressable>

        {/* Narration card — STATIC PLACEHOLDER per sprint 17a decision §7.
            Tier-A narration is first-person + singleton-scoped; the
            parent-scoped variant is a follow-up. The placeholder is
            voice-clean and calm. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.l,
            marginTop: theme.spacing.xxl,
          }}
        >
          <NarrationCard
            theme={theme}
            text={`Here's how ${headerText.parentName} has been doing today.`}
          />
        </View>

        {seededLearn.article ? (
          <HomeLearnCard
            article={seededLearn.article}
            onArticleOpen={(id) => {
              seededLearn.onArticleOpen(id);
              navigation.navigate('Article', { articleId: id });
            }}
            onDismiss={seededLearn.onDismiss}
            testID="parent-dashboard-learn-card"
          />
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.l,
            gap: theme.spacing.m,
          }}
          testID="parent-dashboard-tile-strip"
        >
          <VitalTile
            vitalType="bp"
            value={
              data.bp.latest
                ? `${data.bp.latest.systolic}/${data.bp.latest.diastolic}`
                : '—'
            }
            secondary="mmHg"
            ringFill={heroVitals.bp.fill}
            state={data.bp.latest ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('bp')}
            testID="parent-dashboard-tile-bp"
          />
          <VitalTile
            vitalType="hr"
            value={
              data.hr.displayBpm !== null
                ? String(Math.round(data.hr.displayBpm))
                : '—'
            }
            secondary={data.hr.displaySource === 'latest' ? 'bpm latest' : 'bpm resting'}
            ringFill={heroVitals.hr.fill}
            state={data.hr.displayBpm !== null ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('hr')}
            testID="parent-dashboard-tile-hr"
          />
          <VitalTile
            vitalType="spo2"
            value={
              data.spo2.latestPercent !== null
                ? `${data.spo2.latestPercent}%`
                : '—'
            }
            secondary="oxygen"
            ringFill={heroVitals.spo2.fill}
            state={data.spo2.latestPercent !== null ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('spo2')}
            testID="parent-dashboard-tile-spo2"
          />
          <VitalTile
            vitalType="sleep"
            value={
              data.sleep.session
                ? formatSleepHm(data.sleep.session.totalMinutes)
                : '—'
            }
            secondary="last night"
            ringFill={heroVitals.sleep.fill}
            state={data.sleep.session ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('sleep')}
            testID="parent-dashboard-tile-sleep"
          />
          <VitalTile
            vitalType="activity"
            value={
              data.activity.stepsToday > 0
                ? data.activity.stepsToday.toLocaleString()
                : '—'
            }
            secondary="steps today"
            ringFill={heroVitals.activity.fill}
            state={data.activity.stepsToday > 0 ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('activity')}
            testID="parent-dashboard-tile-activity"
          />
        </ScrollView>
        </>
        )}

        {correlation ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.l,
              marginTop: theme.spacing.l,
            }}
          >
            <CorrelationStrip
              vitalA={correlation.sleep}
              vitalB={correlation.hr}
              range="7d"
              caption="Sleep × resting HR — last 7 days"
              testID="parent-dashboard-correlation"
            />
          </View>
        ) : null}

        <View style={{ marginTop: theme.spacing.xxl }}>
          <DaySpine
            moments={moments}
            onSelect={handleMomentPress}
            testID="parent-dashboard-day-spine"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// Sub-components — local to this screen
// =============================================================================

interface PulseHeaderProps {
  theme: Theme;
  eyebrow: string;
  parentName: string;
  onBack: () => void;
}

function PulseHeader({ theme, eyebrow, parentName, onBack }: PulseHeaderProps) {
  const eyebrowStyle = theme.type('labelUppercase');
  const greetingStyle = theme.type('displayM');
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.l,
        paddingHorizontal: theme.spacing.l,
        paddingTop: theme.spacing.s,
      }}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back to family circle"
        hitSlop={12}
        testID="parent-dashboard-back"
        style={({ pressed }) => ({
          width: 38,
          height: 38,
          borderRadius: 99,
          backgroundColor: theme.colors.surface.warmElevated,
          borderWidth: 0.5,
          borderColor: theme.colors.border.rim,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.editorial,
            fontSize: 18,
            color: theme.colors.text.secondary,
          }}
        >
          {'‹'}
        </Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: eyebrowStyle.family,
            fontSize: eyebrowStyle.size,
            lineHeight: eyebrowStyle.lineHeight,
            letterSpacing: eyebrowStyle.letterSpacing,
            color: theme.colors.text.tertiary,
            textTransform: 'uppercase',
            marginBottom: theme.spacing.xs,
          }}
        >
          {eyebrow}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.editorial,
            fontSize: greetingStyle.size,
            lineHeight: greetingStyle.lineHeight,
            color: theme.colors.text.primary,
          }}
        >
          Checking in on{' '}
          <Text style={{ fontStyle: 'italic', color: theme.colors.text.secondary }}>
            {parentName}
          </Text>
          .
        </Text>
      </View>
    </View>
  );
}

interface RemoteRefreshNudgeRowProps {
  theme: Theme;
  parentName: string;
  state: RemoteRefreshNudgeState;
  onSend: () => void;
}

// Silent-first remote-refresh fallback. Renders nothing until a silent
// sync has gone quiet ('offer'); the caregiver's tap sends the visible
// nudge and we acknowledge it ('sent'). Voice: calm, specific, no fear.
function RemoteRefreshNudgeRow({
  theme,
  parentName,
  state,
  onSend,
}: RemoteRefreshNudgeRowProps) {
  if (state !== 'offer' && state !== 'sent') return null;
  const bodyStyle = theme.type('bodyM');
  const labelStyle = theme.type('label');
  return (
    <View
      style={{
        marginHorizontal: theme.spacing.l,
        marginTop: theme.spacing.l,
        padding: theme.spacing.l,
        borderRadius: theme.radii.l,
        backgroundColor: theme.colors.surface.warmSubtle,
        borderWidth: 0.5,
        borderColor: theme.colors.border.rim,
      }}
      testID="parent-dashboard-refresh-nudge"
    >
      <Text
        style={{
          fontFamily: bodyStyle.family,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          color: theme.colors.text.primary,
        }}
      >
        {state === 'sent'
          ? `Reminder sent to ${parentName}.`
          : `Haven't heard back from ${parentName}'s phone yet.`}
      </Text>
      {state === 'offer' ? (
        <Pressable
          onPress={onSend}
          accessibilityRole="button"
          accessibilityLabel={`Send ${parentName} a reminder to sync`}
          hitSlop={8}
          testID="parent-dashboard-refresh-nudge-send"
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            marginTop: theme.spacing.m,
            paddingVertical: theme.spacing.s,
            paddingHorizontal: theme.spacing.l,
            borderRadius: 99,
            borderWidth: 1,
            borderColor: theme.colors.brand.coral,
            backgroundColor: theme.colors.surface.warmElevated,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: labelStyle.family,
              fontSize: labelStyle.size,
              color: theme.colors.brand.coral,
            }}
          >
            Send a reminder
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface NarrationCardProps {
  theme: Theme;
  text: string;
}

function NarrationCard({ theme, text }: NarrationCardProps) {
  const labelStyle = theme.type('labelUppercase');
  const bodyStyle = theme.type('bodyM');
  return (
    <View
      style={{
        padding: theme.spacing.l,
        borderRadius: theme.radii.l,
        backgroundColor: theme.colors.surface.warmSubtle,
        borderWidth: 0.5,
        borderColor: theme.colors.border.rim,
      }}
      testID="parent-dashboard-narration"
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          color: theme.colors.brand.coral,
          textTransform: 'uppercase',
          marginBottom: theme.spacing.s,
        }}
      >
        Leiko · today
      </Text>
      <Text
        style={{
          fontFamily: bodyStyle.family,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          color: theme.colors.text.primary,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

// =============================================================================
// Helpers — exported for tests
// =============================================================================

interface BannerState {
  severity: 'calm-concerned' | 'confirmed-urgent';
  title: string;
  body: string;
}

export function deriveParentBanner(
  data: DailyPulseData,
  parent: ParentSummary | null,
): BannerState | null {
  const tier = data.bp.classification?.tier;
  const name = parent?.parentDisplayName ?? 'them';
  if (tier === 'confirmed_urgent') {
    return {
      severity: 'confirmed-urgent',
      title: `Talk to ${name} today`,
      body: `Their recent readings are unusually high. Worth talking to a doctor today.`,
    };
  }
  if (tier === 'calm_concerned') {
    return {
      severity: 'calm-concerned',
      title: `Worth a chat with ${name}`,
      body: `A few of ${name}'s recent readings have been higher than usual. Might be worth a gentle check-in.`,
    };
  }
  return null;
}

export function buildParentCorrelation(
  sleepSessions: SleepSession[],
  hrSamples: HRSample[],
): { sleep: VitalSeries; hr: VitalSeries } | null {
  const cutoffSec = Math.floor(Date.now() / 1000) - SECONDS_PER_WEEK;
  const sleepPoints = sleepSessions
    .filter((s) => s.sessionEndSec >= cutoffSec)
    .map((s) => ({ t: s.sessionEndSec, value: sleepScoreForSession(s) }));
  const hrPoints = hrSamples
    .filter((h) => h.measuredAtSec >= cutoffSec && h.motionState === 'rest')
    .map((h) => ({ t: h.measuredAtSec, value: h.bpm }));
  if (sleepPoints.length === 0 && hrPoints.length === 0) return null;
  return {
    sleep: { type: 'sleep', points: sleepPoints },
    hr: { type: 'hr', points: hrPoints },
  };
}

export function buildParentHeader(parent: ParentSummary | null): {
  date: string;
  parentName: string;
} {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
  const month = now.toLocaleDateString(undefined, { month: 'long' });
  const date = `${weekday} · ${month} ${now.getDate()}`;
  // parentDisplayName is the user-supplied first-person reference for
  // the parent ("Mum", "Dad", or a given name). Fall back to a calm
  // neutral when absent (rare: family-readings hasn't loaded yet).
  const parentName = parent?.parentDisplayName?.trim() || 'your loved one';
  return { date, parentName };
}

function formatSleepHm(totalMinutes: number): string {
  const total = Math.round(totalMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
