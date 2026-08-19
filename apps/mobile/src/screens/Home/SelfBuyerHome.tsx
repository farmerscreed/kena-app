// Self-Buyer Home — Sprint 8 (Daily Pulse).
//
// The screen that defines the brand for self-buyers. Replaces the
// placeholder Sprint 4 shipped (`SelfBuyerHomePlaceholder`).
//
// Layout (per docs/04-screens/self-buyer-home.md, sourced from the
// design bundle in docs/_reference/design-bundles.md — leiko-home.html
// with the 4th "Recents" section swapped for the v2 DaySpine):
//
//   1. PulseHeader       — eyebrow date + greeting + avatar
//   2. AnomalyBanner     — when latest BP classifies calm_concerned / urgent
//   3. DailyPulseHero    — 5-vital constellation, immersive mode,
//                          adaptive central value per D13 §7.2
//   4. AINarration card  — placeholder string until Sprint 12.5
//   5. VitalTile strip   — horizontal scroll, 5 tiles
//   6. CorrelationStrip  — sleep × resting HR over 7 days
//   7. DaySpine          — Through your day (real moments, no AI)
//   8. TabBar (visual)   — Home active; Settings wired; Trends/Family
//                          render but route to placeholder (Sprints 9/10)
//   9. TakeReadingFAB    — opens existing TakeReading walkthrough
//
// Voice rules (docs/05-voice-and-claims.md): every user-visible string
// in this file is calm + plain + voice-rule clean. No "patient",
// "diagnose", "predict", "dangerous", "critical", "silent killer".
// Reassuring tone by default; calm-concerned tone only when the
// underlying classification calls for it.

import { useCallback, useMemo, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AnomalyBanner } from '../../components/AnomalyBanner';
import { bannerCopyFor } from '../../utils/anomalyBannerCopy';
import { ScreenAnomalyBanner } from '../../components/ScreenAnomalyBanner';
import { SyncReassuranceBanner } from '../../components/SyncReassuranceBanner';
import { QuietHoursAffirmSheet } from '../../components/QuietHoursAffirmSheet';
import { useQuietHoursAffirm } from '../../hooks/useQuietHoursAffirm';
import { AskLeikoSheet } from '../../components/AskLeikoSheet';
import { HealthPlatformPermissionPrompt } from '../../components/HealthPlatformPermissionPrompt';
import { SixthReadingPaywallHost } from '../../components/SixthReadingPaywallHost';
import { DailyPulseHero, type DailyPulseHeroVitals } from '../../components/DailyPulseHero';
import { HomeLearnCard } from '../../components/HomeLearnCard';
// Sprint 19 (audit P1-3) — single source of truth for the bottom
// furniture stack (tab bar + Ask Leiko FAB) and the scroll padding that
// must clear it.
import {
  ASK_LEIKO_FAB_HEIGHT,
  HOME_TAB_BAR_HEIGHT,
  homeFurnitureBottom,
  homeScrollPaddingBottom,
  type HomeFurniture,
} from '../../components/homeLayout';
import { useSeededLearnCard } from '../../hooks/useSeededLearnCard';
import { useEnsureSelfBuyerFamily } from '../../hooks/useEnsureSelfBuyerFamily';
import { useDailyNarration } from '../../hooks/useDailyNarration';
import { useHydrateReadingsFromServer } from '../../hooks/useHydrateReadingsFromServer';
import { useHydrateSleepFromServer } from '../../hooks/useHydrateSleepFromServer';
import { useHydrateActivityFromServer } from '../../hooks/useHydrateActivityFromServer';
import { useHydrateHRFromServer } from '../../hooks/useHydrateHRFromServer';
import { useHydrateSpO2FromServer } from '../../hooks/useHydrateSpO2FromServer';
import { VitalTile } from '../../components/VitalTile';
import {
  CorrelationStrip,
  type VitalSeries,
} from '../../components/CorrelationStrip';
import { DaySpine } from '../../components/DaySpine';
import { useDailyPulseData } from '../../state/dailyPulse';
import { bpRingFill } from '../../utils/vitalThemes';
import { canonicalTierFor } from '../../utils/classification';
import { CanvasGradient } from '../../components/CanvasGradient';
import { useFamilyReadings } from '../../hooks/useFamilyReadings';
import { FamilyRemovalBanner } from '../../components/FamilyRemovalBanner';
import { useFamilyRemovalBanner } from '../../hooks/useFamilyRemovalBanner';
import { useAuth } from '../../state/auth';
import { useHR } from '../../state/hr';
import { usePairing } from '../../state/pairing';
import { useSleep } from '../../state/sleep';
import { useTheme, type Theme } from '../../theme';
import {
  deriveDayMoments,
  pickCentralValue,
  type DayMoment,
} from '../../utils/dayMoments';
import { timeOfDayGreeting } from '../../utils/greeting';
import type { SelfBuyerStackParamList } from '../../navigation/types';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';

type Nav = NativeStackNavigationProp<SelfBuyerStackParamList>;

// Sprint 19 (audit P1-3) — this screen always renders BOTH the tab bar
// and the Ask Leiko FAB. They used to be positioned independently and
// overlapped by 16pt, with the tab bar painting over the FAB because it
// renders second. They are now two layers of one bottom-anchored stack.
// `safeAreaBottom` stays 0: the furniture lives inside the SafeAreaView
// below, which already pads the OS inset.
const SELF_BUYER_FURNITURE: HomeFurniture = { tabBar: true, fab: true };

export function SelfBuyerHome() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  const profile = useAuth((s) => s.profile);
  const { parents, isLoading: familyLoading, isRefreshing, refresh } =
    useFamilyReadings();
  // Sprint 17b — backstop banner if this user (who could be a hybrid
  // mode caregiver of another family) was removed from a circle.
  // Self-buyers can't be removed from their own family (the Edge
  // Function refuses owner-removal); only their secondary
  // memberships are at risk.
  const removalBanner = useFamilyRemovalBanner(parents, familyLoading);
  const data = useDailyPulseData();
  // Sprint 10a — drives the 6th-reading auto-paywall mount below.
  const familyId = parents[0]?.familyId ?? null;
  // Sprint 18 bench bug — self-buyer post-onboarding has no inline
  // pairing affordance; if pairedDevice is null we render a calm
  // "let's pair your watch" prompt under the hero so first-run users
  // don't have to dig into Settings to find pairing.
  const pairedDevice = usePairing((s) => s.pairedDevice);

  // ----- Adaptive central value (D13 §7.2) ---------------------------
  const central = useMemo(() => pickCentralValue(data), [data]);

  // ----- Hero ring fills per D13 §7.1 --------------------------------
  const heroVitals = useMemo<DailyPulseHeroVitals>(
    () => buildHeroVitals(data),
    [data],
  );

  // ----- Anomaly banner derived from BP tier -------------------------
  const banner = useMemo(() => deriveBanner(data), [data]);

  // ----- Sprint 14: seeded Learn card slot ---------------------------
  const seededLearn = useSeededLearnCard();

  // ----- Sprint 14.5: backfill family for legacy self-buyers ---------
  // Idempotent — no-ops once a membership row exists. Fires only for
  // accounts that predate Sprint 4 onboarding (rare in prod, common
  // for dev test users).
  useEnsureSelfBuyerFamily();

  // ----- Sprint 12.5 fix: server → local readings recovery -----------
  // Self-heals an empty local store after reinstall / MMKV clear by
  // pulling the family's last 30 server-side readings. No-ops when
  // local already has data. See useHydrateReadingsFromServer.
  useHydrateReadingsFromServer();
  // Sprint 16.5c — same pattern for sleep. The watch's day-info
  // storage rolls over after a few days, so a re-sync only re-pulls
  // last night even when the server has 30+ historical sessions.
  // This hook tops up the sleep slice from the server when local has
  // < FETCH_LIMIT rows.
  useHydrateSleepFromServer();
  // Sprint 16.5e — same pattern for steps + calories. Same watch
  // rollover; without this the ActivityDetail screen + the activity
  // tile show only today's row after a few days of normal use.
  useHydrateActivityFromServer();
  // Sprint 16.5e — HR + SpO2 round out the multi-day hydration set.
  // HR's recent cap is ~16h dense, but the SpO2 hourly cadence + the
  // sleep × resting-HR correlation strip both need server-side history.
  useHydrateHRFromServer();
  useHydrateSpO2FromServer();

  // ----- Sprint 12 follow-up: Ask Leiko bottom sheet ----------------
  const [askLeikoVisible, setAskLeikoVisible] = useState(false);

  // ----- Sprint 12.5: ambient AI daily narration --------------------
  // Replaces the Sprint 8 PLACEHOLDER_AI_NARRATION strings with a
  // real Tier-A template from Sprint 11's library, slot-substituted
  // with the actual vital values. Tier-B novel-pattern path lands
  // in session 2.
  const dailyNarration = useDailyNarration();

  // ----- DaySpine moments --------------------------------------------
  const moments = useMemo(() => deriveDayMoments(data), [data]);

  // ----- Correlation strip series (sleep × HR over 7d) ---------------
  const sleepRecent = useSleep((s) => s.recent);
  const hrRecent = useHR((s) => s.recent);
  const correlation = useMemo(
    () => buildCorrelation(sleepRecent, hrRecent),
    [sleepRecent, hrRecent],
  );

  // ----- Greeting + date string --------------------------------------
  const headerText = useMemo(() => buildHeader(profile?.display_name), [profile]);

  const handleHeroPress = useCallback(() => {
    // Hero tap → BP detail screen. The central value is BP-headline by
    // D13 §7.2 priority cascade, so opening the BP trend screen is the
    // most useful drill-in regardless of which adaptive value is showing.
    // (On-device review 2026-05-08: previous code routed to
    // ReadingDetail with an empty localId → blank screen.)
    navigation.navigate('VitalDetail', { vital: 'bp' });
  }, [navigation]);

  const handleVitalPress = useCallback(
    (vital: 'bp' | 'hr' | 'spo2' | 'sleep' | 'activity') => {
      navigation.navigate('VitalDetail', { vital });
    },
    [navigation],
  );

  const handleMomentPress = useCallback(
    (m: DayMoment) => {
      handleVitalPress(m.vital);
    },
    [handleVitalPress],
  );

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.warmBase }]}
      edges={['top', 'bottom']}
    >
      {/* D13 PR-5 (§5.4) — canvas gradient under everything. */}
      <CanvasGradient />
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            // Sprint 19 (audit P1-3) — was a flat 96pt, which the FAB
            // (top edge at 124pt) already overran. Derived now.
            paddingBottom: homeScrollPaddingBottom(SELF_BUYER_FURNITURE),
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={theme.colors.brand.coral}
          />
        }
      >
        <PulseHeader
          theme={theme}
          eyebrow={headerText.date}
          greeting={headerText.greeting}
          name={headerText.name}
          onAvatarPress={() => navigation.navigate('Settings')}
        />

        {/* Sprint 17b — surfaces when this user was removed from a
            family circle they were a member of (hybrid mode only;
            self-buyers can't be removed from their own family). */}
        {removalBanner.removed ? (
          <FamilyRemovalBanner
            label={removalBanner.removed.label}
            onDismiss={removalBanner.dismiss}
            testID="self-buyer-home-removal-banner"
          />
        ) : null}

        {/* Sprint 16 — calm reassurance banner after 24h of failed
            /sync. Renders only when the failure-tracker reports a
            streak past the threshold; otherwise null. */}
        <SyncReassuranceBanner testID="self-buyer-home-sync-reassurance" />

        {/* Sprint 15 — server-driven anomaly banner (most-severe-wins
            across BP/HR/SpO2). Renders nothing when there's no
            unacknowledged event. The legacy local-tier banner below
            still renders as a fallback so cold-start clients without a
            server event yet still see the calm-concerned cue. */}
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
              cta={banner.cta}
              testID="self-buyer-home-anomaly-banner"
            />
          </View>
        ) : null}

        {/* Hero — adaptive centre + 5-ring constellation. Tap-through to
            ReadingDetail when a BP reading exists. */}
        <Pressable
          onPress={handleHeroPress}
          accessibilityRole={data.bp.latest ? 'button' : 'text'}
          accessibilityHint={
            data.bp.latest ? 'Opens the latest reading detail.' : undefined
          }
          style={{
            marginTop: theme.spacing.xxl,
            alignItems: 'center',
          }}
          testID="self-buyer-home-hero-pressable"
        >
          <DailyPulseHero
            vitals={heroVitals}
            central={{
              label:
                central.priority === 'bp'
                  ? 'Blood pressure'
                  : central.label,
              value: central.value,
              sub: buildCentralSub(data, central.priority),
              unit: buildCentralUnit(central.priority),
              // Sprint 19 (audit P1-5) — the tier was already computed
              // two lines from here (deriveBanner reads the same field)
              // and never reached the biggest number on the screen. Only
              // passed when the cascade actually resolved to BP; the HR
              // fallback has no BP verdict to show.
              tier:
                central.priority === 'bp'
                  ? data.bp.classification?.tier ?? null
                  : null,
              // D13 PR-4 — verdict-aware tier so the learning state
              // renders grey with honest copy.
              canonicalTier:
                central.priority === 'bp' && data.bp.classification
                  ? canonicalTierFor(data.bp.classification)
                  : null,
              live: false,
            }}
            onSelectVital={handleVitalPress}
            testID="self-buyer-home-hero"
          />
        </Pressable>

        {/* Sprint 18 bench bug — first-run self-buyer with no watch
            paired had no inline pairing CTA on Home and had to dig into
            Settings. This calm prompt slots between the hero and the
            narration so the next action is obvious. Disappears the
            moment usePairing has a pairedDevice. */}
        {!pairedDevice ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.l,
              marginTop: theme.spacing.xxl,
            }}
          >
            <PairWatchPrompt
              theme={theme}
              onPair={() => navigation.navigate('Pairing')}
            />
          </View>
        ) : null}

        {/* AI narration card — placeholder string until Sprint 12.5. */}
        <View
          style={{
            paddingHorizontal: theme.spacing.l,
            marginTop: theme.spacing.xxl,
          }}
        >
          <NarrationCard
            theme={theme}
            text={
              banner !== null
                ? "We've noticed a pattern. Your numbers below tell the rest of the story."
                : dailyNarration.text
            }
          />
        </View>

        {/* "Worth a read" home-seeded Learn card — Sprint 14. */}
        {seededLearn.article ? (
          <HomeLearnCard
            article={seededLearn.article}
            onArticleOpen={(id) => {
              seededLearn.onArticleOpen(id);
              navigation.navigate('Article', { articleId: id });
            }}
            onDismiss={seededLearn.onDismiss}
            testID="self-buyer-home-learn-card"
          />
        ) : null}

        {/* Vital tile strip — horizontal scroll. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.l,
            gap: theme.spacing.m,
          }}
          testID="self-buyer-home-tile-strip"
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
            testID="self-buyer-home-tile-bp"
          />
          <VitalTile
            vitalType="hr"
            value={data.hr.displayBpm !== null ? String(Math.round(data.hr.displayBpm)) : '—'}
            secondary={data.hr.displaySource === 'latest' ? 'bpm latest' : 'bpm resting'}
            ringFill={heroVitals.hr.fill}
            state={data.hr.displayBpm !== null ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('hr')}
            testID="self-buyer-home-tile-hr"
          />
          <VitalTile
            vitalType="spo2"
            value={data.spo2.latestPercent !== null ? `${data.spo2.latestPercent}%` : '—'}
            secondary="oxygen"
            ringFill={heroVitals.spo2.fill}
            state={data.spo2.latestPercent !== null ? 'normal' : 'no-data'}
            onPress={() => handleVitalPress('spo2')}
            testID="self-buyer-home-tile-spo2"
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
            testID="self-buyer-home-tile-sleep"
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
            testID="self-buyer-home-tile-activity"
          />
        </ScrollView>

        {/* Correlation strip — sleep × HR over the last 7 days. */}
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
              testID="self-buyer-home-correlation"
            />
          </View>
        ) : null}

        {/* Through your day — DaySpine moments. */}
        <View style={{ marginTop: theme.spacing.xxl }}>
          <DaySpine
            moments={moments}
            onSelect={handleMomentPress}
            testID="self-buyer-home-day-spine"
          />
        </View>
      </ScrollView>

      {/* Sprint 12 follow-up — floating "Ask Leiko" replaces the
          previous Take-a-reading "+" FAB. Take a reading moves to
          the centre tab-bar slot below. */}
      <AskLeikoFAB
        theme={theme}
        onPress={() => setAskLeikoVisible(true)}
      />

      {/* Visual tab bar — Home / Trends / [+] Take a reading / Learn /
          Settings. The "+" is a centre stage button for the primary
          self-buyer action; the four side tabs are the orientation
          spine. Family was dropped in 10c.2 — it lives in Settings
          for the rare hybrid-mode user. */}
      <SelfBuyerTabBar
        theme={theme}
        onSelect={(tab) => {
          switch (tab) {
            case 'home':
              return; // already here
            case 'settings':
              navigation.navigate('Settings');
              return;
            case 'trends':
              navigation.navigate('Trends');
              return;
            case 'take_reading':
              navigation.navigate('TakeReading');
              return;
            case 'learn':
              navigation.navigate('Learn');
              return;
          }
        }}
      />

      <AskLeikoSheet
        visible={askLeikoVisible}
        onDismiss={() => setAskLeikoVisible(false)}
        onArticleOpen={(id) => navigation.navigate('Article', { articleId: id })}
      />
      {/* Sprint 9.5 / Task 8 — Apple Health / Health Connect opt-in
          (D13 §12.5). Self-buyer asked at end of onboarding (i.e. on
          first home render after onboardingComplete flips). The
          component owns its own visibility — gates on the prompted
          MMKV flag + skips for caregivers. */}
      <HealthPlatformPermissionPrompt />
      {/* Sprint 10a — D8a §9.1 6th-reading auto-paywall. Self-buyer
          variant: same trigger logic, copy switches by account_type. */}
      <SixthReadingPaywallHost accountType="self_buyer" familyId={familyId} />
      <QuietHoursAffirmSlot />
    </SafeAreaView>
  );
}

// Sprint 15 — one-shot quiet-hours-override affirm sheet. Slotted at
// end of the screen tree so it overlays the home content. The hook
// gates on the MMKV one-shot flag.
function QuietHoursAffirmSlot() {
  const { visible, dismiss } = useQuietHoursAffirm();
  return <QuietHoursAffirmSheet visible={visible} onDone={dismiss} />;
}

// =============================================================================
// Sub-components — kept inline; not used elsewhere as of Sprint 8.
// =============================================================================

interface PulseHeaderProps {
  theme: Theme;
  eyebrow: string;
  greeting: string;
  name: string;
  onAvatarPress: () => void;
}

function PulseHeader({ theme, eyebrow, greeting, name, onAvatarPress }: PulseHeaderProps) {
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
          {greeting},{' '}
          <Text style={{ fontStyle: 'italic', color: theme.colors.text.secondary }}>
            {name}
          </Text>
          .
        </Text>
      </View>
      <Pressable
        onPress={onAvatarPress}
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        hitSlop={8}
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
        testID="self-buyer-home-settings"
      >
        {/* Sprint 17b polish — the affordance is "open settings", so
            show a settings glyph (matches CaregiverHome's pattern at
            screens/Home/CaregiverHome.tsx). Previously displayed the
            user's first initial, which was visually identical to a
            generic avatar bubble and read as "B" instead of
            "Settings". Phosphor GearSix lands when the icon library
            sweep ships. */}
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontSize: 18,
            color: theme.colors.text.secondary,
            lineHeight: 18,
          }}
        >
          {'⚙'}
        </Text>
      </Pressable>
    </View>
  );
}

interface NarrationCardProps {
  theme: Theme;
  text: string;
}

// Sprint 18 bench bug — calm pairing prompt rendered on self-buyer Home
// when no watch is paired. Matches NarrationCard's visual weight so it
// sits naturally below the hero. Tapping anywhere on the card routes to
// the Pairing screen; an explicit "Pair watch" pressable carries the
// label for screen readers + accessibility.
interface PairWatchPromptProps {
  theme: Theme;
  onPair: () => void;
}

function PairWatchPrompt({ theme, onPair }: PairWatchPromptProps) {
  const labelStyle = theme.type('labelUppercase');
  const titleStyle = theme.type('title');
  const bodyStyle = theme.type('bodyM');
  return (
    <Pressable
      onPress={onPair}
      accessibilityRole="button"
      accessibilityLabel="Pair your watch"
      accessibilityHint="Opens the pairing flow"
      testID="self-buyer-home-pair-watch-prompt"
      style={({ pressed }) => ({
        padding: theme.spacing.l,
        borderRadius: theme.radii.l,
        backgroundColor: theme.colors.surface.warmElevated,
        borderWidth: 0.5,
        borderColor: theme.colors.border.rim,
        opacity: pressed ? 0.85 : 1,
      })}
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
        Your watch
      </Text>
      <Text
        style={{
          fontFamily: titleStyle.family,
          fontSize: titleStyle.size,
          lineHeight: titleStyle.lineHeight,
          fontWeight: titleStyle.weight as '600',
          color: theme.colors.text.primary,
          marginBottom: theme.spacing.xs,
        }}
      >
        Pair your watch to start.
      </Text>
      <Text
        style={{
          fontFamily: bodyStyle.family,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          color: theme.colors.text.secondary,
          marginBottom: theme.spacing.m,
        }}
      >
        Once connected, your readings start syncing on their own.
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        <Text
          style={{
            fontFamily: bodyStyle.family,
            fontSize: bodyStyle.size,
            lineHeight: bodyStyle.lineHeight,
            fontWeight: '600',
            color: theme.colors.brand.coral,
          }}
        >
          Pair watch  ›
        </Text>
      </View>
    </Pressable>
  );
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
      testID="self-buyer-home-narration"
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
        Leiko · this morning
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

interface AskLeikoFABProps {
  theme: Theme;
  onPress: () => void;
}

// Sprint 12 follow-up — replaces SelfBuyerFAB ("+"). Tapping opens
// the AskLeikoSheet bottom sheet. Take-a-reading moved to the
// centre tab-bar slot. The shape (round, brand-coral, anchored above
// the tab bar) is preserved so the affordance reads as the same
// "primary action" surface — only the action changed.
function AskLeikoFAB({ theme, onPress }: AskLeikoFABProps) {
  const labelStyle = theme.type('labelUppercase');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Ask Leiko"
      accessibilityHint="Opens a popup to ask a question about your numbers"
      onPress={onPress}
      testID="self-buyer-home-ask-leiko-fab"
      style={({ pressed }) => ({
        position: 'absolute',
        right: theme.spacing.xl,
        // Sprint 19 (audit P1-3) — was `theme.spacing.xxxxl +
        // theme.spacing.xl` (68), which put the FAB at 68..124 while the
        // tab bar sat at 24..84. They overlapped, and the tab bar
        // rendered second so it painted over the FAB. Stacked properly
        // now: the FAB sits a gap above the tab bar's top edge.
        bottom: homeFurnitureBottom('fab', SELF_BUYER_FURNITURE),
        height: ASK_LEIKO_FAB_HEIGHT,
        paddingHorizontal: theme.spacing.l,
        borderRadius: 28,
        backgroundColor: pressed
          ? theme.colors.brand.primaryPressed
          : theme.colors.brand.coral,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        ...theme.elevation.medium.ios,
        ...theme.elevation.medium.android,
      })}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontFamily: labelStyle.family,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          letterSpacing: labelStyle.letterSpacing,
          textTransform: 'uppercase',
          color: theme.colors.text.onBrand,
          fontWeight: '500',
        }}
      >
        Ask Leiko
      </Text>
    </Pressable>
  );
}

// Sprint 10c.2 polish — IA review: self-buyers' mental model is
// "understand my numbers", not family. Family management lives in
// Settings.
//
// Sprint 12 follow-up — Take a reading moved to a centre stage slot
// between Trends and Learn. The "+" button is rendered with a
// distinct elevated treatment so it reads as the primary action; the
// four side tabs (Home / Trends / Learn / Settings) form the
// orientation spine.
type SelfBuyerTab = 'home' | 'trends' | 'take_reading' | 'learn' | 'settings';

interface SelfBuyerTabBarProps {
  theme: Theme;
  onSelect: (tab: SelfBuyerTab) => void;
}

function SelfBuyerTabBar({ theme, onSelect }: SelfBuyerTabBarProps) {
  const sideTabs: Array<{ id: SelfBuyerTab; label: string; active: boolean }> = [
    { id: 'home', label: 'Home', active: true },
    { id: 'trends', label: 'Trends', active: false },
    { id: 'learn', label: 'Learn', active: false },
    { id: 'settings', label: 'Settings', active: false },
  ];
  const leftSide = sideTabs.slice(0, 2);
  const rightSide = sideTabs.slice(2);
  const labelStyle = theme.type('labelUppercase');
  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: theme.spacing.m,
        right: theme.spacing.m,
        // Sprint 19 (audit P1-3) — shared with HomeTabBar (which this
        // local copy mirrors) via the furniture stack model.
        bottom: homeFurnitureBottom('tabBar', SELF_BUYER_FURNITURE),
        height: HOME_TAB_BAR_HEIGHT,
        borderRadius: 28,
        backgroundColor: theme.colors.surface.warmElevated,
        borderWidth: 0.5,
        borderColor: theme.colors.border.rim,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.s,
        ...theme.elevation.high.ios,
        ...theme.elevation.high.android,
      }}
      testID="self-buyer-home-tab-bar"
    >
      {leftSide.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onSelect(t.id)}
          accessibilityRole="tab"
          accessibilityState={{ selected: t.active }}
          accessibilityLabel={t.label}
          hitSlop={8}
          testID={`self-buyer-home-tab-${t.id}`}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.s,
            borderRadius: 16,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: labelStyle.family,
              fontSize: labelStyle.size,
              lineHeight: labelStyle.lineHeight,
              letterSpacing: labelStyle.letterSpacing,
              textTransform: 'uppercase',
              color: t.active
                ? theme.colors.brand.coral
                : theme.colors.text.tertiary,
            }}
          >
            {t.label}
          </Text>
        </Pressable>
      ))}

      {/* Centre stage — Take a reading. Distinct round elevated
          button (D11 premium-precise; brand-coral primary). Sits
          BETWEEN Trends (left) and Learn (right). */}
      <Pressable
        onPress={() => onSelect('take_reading')}
        accessibilityRole="button"
        accessibilityLabel="Take a reading"
        accessibilityHint="Walks you through taking a reading on your watch"
        hitSlop={8}
        testID="self-buyer-home-tab-take_reading"
        style={({ pressed }) => ({
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: pressed
            ? theme.colors.brand.primaryPressed
            : theme.colors.brand.coral,
          alignItems: 'center',
          justifyContent: 'center',
          marginHorizontal: theme.spacing.s,
          ...theme.elevation.medium.ios,
          ...theme.elevation.medium.android,
        })}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{
            fontFamily: theme.fontFamilies.display,
            fontSize: 26,
            lineHeight: 26,
            color: theme.colors.text.onBrand,
          }}
        >
          +
        </Text>
      </Pressable>

      {rightSide.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => onSelect(t.id)}
          accessibilityRole="tab"
          accessibilityState={{ selected: t.active }}
          accessibilityLabel={t.label}
          hitSlop={8}
          testID={`self-buyer-home-tab-${t.id}`}
          style={({ pressed }) => ({
            paddingHorizontal: theme.spacing.l,
            paddingVertical: theme.spacing.s,
            borderRadius: 16,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontFamily: labelStyle.family,
              fontSize: labelStyle.size,
              lineHeight: labelStyle.lineHeight,
              letterSpacing: labelStyle.letterSpacing,
              textTransform: 'uppercase',
              color: t.active
                ? theme.colors.brand.coral
                : theme.colors.text.tertiary,
            }}
          >
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// =============================================================================
// Helpers — pure transforms over DailyPulseData. Exported for the test
// suite when sensible (banner derivation tested as part of integration).
// =============================================================================

/** D13 §7.1 ring fill formulas + per-satellite display + unit strings.
 *  Produces the heroVitals shape consumed by the constellation hero. */
export function buildHeroVitals(
  data: ReturnType<typeof useDailyPulseData>,
): DailyPulseHeroVitals {
  // D13 PR-4 (§6.2) — the ring's stroke encodes data sufficiency.
  const bpFill = bpRingFill(data.bp.classification);
  const hrFill = data.hr.displayBpm !== null
    ? clamp01((data.hr.displayBpm - 40) / 80)
    : 0;
  const spo2Fill = data.spo2.latestPercent !== null
    ? clamp01((data.spo2.latestPercent - 85) / 15)
    : 0;
  const sleepFill = data.sleep.session
    ? clamp01(sleepScoreForSession(data.sleep.session) / 100)
    : 0;
  const activityFill = data.activity.targetSteps > 0
    ? clamp01(data.activity.stepsToday / data.activity.targetSteps)
    : 0;

  const bp = data.bp.latest;
  return {
    bp: {
      fill: bpFill,
      display: bp ? `${bp.systolic}/${bp.diastolic}` : '—',
      unit: 'mmHg',
    },
    hr: {
      fill: hrFill,
      // rollingMinAverage returns float; round at every display
      // boundary so the hero / tiles never show "63.3333…".
      display:
        data.hr.displayBpm !== null ? String(Math.round(data.hr.displayBpm)) : '—',
      unit: 'bpm',
    },
    spo2: {
      fill: spo2Fill,
      display:
        data.spo2.latestPercent !== null ? `${data.spo2.latestPercent}` : '—',
      unit: '%',
    },
    sleep: {
      fill: sleepFill,
      display: data.sleep.session
        ? formatSleepHm(data.sleep.session.totalMinutes)
        : '—',
      unit: 'hrs',
    },
    activity: {
      fill: activityFill,
      display:
        data.activity.stepsToday > 0
          ? data.activity.stepsToday.toLocaleString()
          : '—',
      unit: 'steps',
    },
  };
}

/**
 * Builds the small mono caption that sits under the giant value inside
 * the central BP ring — when the reading was taken, or what the
 * fallback value describes. Pure helper.
 *
 * Sprint 19 (audit P1-5): the unit moved OUT of this string. It now
 * belongs to the hero's verdict line ("mmHg · within your usual range"),
 * composed by `vitalRangeCopyForTier` — see `buildCentralUnit` below.
 * Keeping the unit here as well would print it twice.
 */
export function buildCentralSub(
  data: ReturnType<typeof useDailyPulseData>,
  priority: 'bp' | 'hr' | 'sleep' | 'none',
): string | undefined {
  switch (priority) {
    case 'bp': {
      if (!data.bp.latestSampleSec) return undefined;
      return new Date(data.bp.latestSampleSec * 1000).toLocaleTimeString(
        undefined,
        { hour: 'numeric', minute: '2-digit' },
      );
    }
    // The HR / sleep fallbacks keep their unit inline: they have no
    // classification tier, so they get no verdict line to carry it.
    case 'hr':
      return 'bpm · resting';
    case 'sleep':
      return 'last night';
    case 'none':
    default:
      return undefined;
  }
}

/**
 * Sprint 19 (audit P1-5) — the unit for the hero's verdict line. The
 * hero pairs it with the classification tier through the shared
 * `vitalRangeCopyForTier`, so home says exactly what BPDetail says.
 *
 * Only BP. The HR / sleep fallbacks in the D13 §7.2 cascade carry no
 * classification of their own, so they keep their unit inline in the
 * caption (see `buildCentralSub`) and render no verdict line.
 */
export function buildCentralUnit(
  priority: 'bp' | 'hr' | 'sleep' | 'none',
): string | undefined {
  return priority === 'bp' ? 'mmHg' : undefined;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

interface BannerState {
  severity: 'calm-concerned' | 'confirmed-urgent';
  title: string;
  body: string;
  cta?: { label: string; onPress: () => void };
}

// D13 PR-2 (P0-4) — the cold-start fallback banner (server has no
// anomaly event yet) no longer carries its own copy. It routes through
// canonical utils/anomalyBannerCopy, the single voice-linted source,
// synthesizing a minimal event from the local classification.
function deriveBanner(
  data: ReturnType<typeof useDailyPulseData>,
): BannerState | null {
  const classification = data.bp.classification;
  const tier = classification?.tier;
  if (tier !== 'confirmed_urgent' && tier !== 'calm_concerned') return null;
  const copy = bannerCopyFor(
    {
      id: 'local-fallback',
      userId: '',
      familyId: '',
      vital: 'bp',
      tier,
      reason: classification?.reason ?? 'outside_band_confirmed',
      readingId: null,
      triggeredAtSec: 0,
      acknowledgedAt: null,
      feedbackThumb: 0,
    },
    'self_buyer',
  );
  return { severity: copy.severity, title: copy.title, body: copy.body };
}

function buildHeader(displayName: string | undefined): {
  date: string;
  greeting: string;
  name: string;
} {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
  const month = now.toLocaleDateString(undefined, { month: 'long' });
  const date = `${weekday} · ${month} ${now.getDate()}`;
  const greeting = timeOfDayGreeting(now);
  const name = displayName?.trim() ? displayName.split(' ')[0] : 'friend';
  return { date, greeting, name };
}

function buildCorrelation(
  sleepRecent: ReturnType<typeof useSleep.getState>['recent'],
  hrRecent: ReturnType<typeof useHR.getState>['recent'],
): { sleep: VitalSeries; hr: VitalSeries } | null {
  // Last 7 days of sleepScore + restingHR. Empty → null (renderer hides
  // the strip until enough data lands).
  const cutoffSec = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const sleepPoints = sleepRecent
    .filter((s) => s.sessionEndSec >= cutoffSec)
    .map((s) => ({ t: s.sessionEndSec, value: sleepScoreForSession(s) }));
  const hrPoints = hrRecent
    .filter((h) => h.measuredAtSec >= cutoffSec && h.motionState === 'rest')
    .map((h) => ({ t: h.measuredAtSec, value: h.bpm }));
  if (sleepPoints.length === 0 && hrPoints.length === 0) return null;
  return {
    sleep: { type: 'sleep', points: sleepPoints },
    hr: { type: 'hr', points: hrPoints },
  };
}

function formatSleepHm(totalMinutes: number): string {
  // totalMinutes can be a float (computed from session start/end +
  // summed stage minutes). Round at the boundary so the tile never
  // shows "7h 24.5m" — fixed-width font + the layout assumes
  // integer minutes.
  const total = Math.round(totalMinutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
