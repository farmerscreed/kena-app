// Caregiver Home — Sprint 7.7a (Family Constellation, bird's-eye view).
//
// Replaces the BP-only Sprint 7 card-stack home with the Family
// Constellation design (`leiko-caregiver-unified.html`). Each loved one
// is a glowing orb in a starfield around a centre "You" mark. A legend
// below carries status pills + headlines. The bottom action bar offers
// "+ Add someone" when the caregiver has invite capacity.
//
// Sprint 7.7b will add the editorial-card view + segmented toggle +
// cinematic transition. The MMKV-backed view-preference hook is plumbed
// here (`useCaregiverViewMode`) but only `birds` renders in 7.7a — the
// `cards` branch is wired in 7.7b.
//
// Drill-in: tapping any orb (or legend row) navigates to ReadingDetail
// for that parent's latest reading, matching the legacy behaviour.
// Sprint 8.5 will introduce a per-parent immersive DailyPulseHero
// screen as the proper drill target.
//
// Voice rules (docs/05-voice-and-claims.md): every user-visible string
// here is calm + plain + in-voice. No "patient", no fear language.
// "+ Add someone" / "all in your circle" / "Your family circle is quiet
// for now" / "Add a family member to start sharing care." — all
// existing voice-rule-clean copy preserved from the legacy screen.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle as SvgCircle,
  Defs,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AnomalyBanner } from '../../components/AnomalyBanner';
import { ScreenAnomalyBanner } from '../../components/ScreenAnomalyBanner';
import { SyncReassuranceBanner } from '../../components/SyncReassuranceBanner';
import { QuietHoursAffirmSheet } from '../../components/QuietHoursAffirmSheet';
import { useQuietHoursAffirm } from '../../hooks/useQuietHoursAffirm';
import { AskLeikoSheet } from '../../components/AskLeikoSheet';
import { HomeLearnCard } from '../../components/HomeLearnCard';
import { useSeededLearnCard } from '../../hooks/useSeededLearnCard';
import { Button } from '../../components/Button';
import { SixthReadingPaywallHost } from '../../components/SixthReadingPaywallHost';
import { CaregiverActionBar } from '../../components/CaregiverActionBar';
import { HomeTabBar } from '../../components/HomeTabBar';
import {
  ConstellationField,
  type ConstellationPerson,
} from '../../components/ConstellationField';
import {
  ConstellationLegend,
  type LegendPerson,
} from '../../components/ConstellationLegend';
import { PersonCard } from '../../components/PersonCard';
import { ViewToggle } from '../../components/ViewToggle';
import { useCaregiverFamily } from '../../hooks/useCaregiverFamily';
import { AcceptInviteSheet } from '../../components/AcceptInviteSheet';
import { ConnectShareSheet } from '../../components/ConnectShareSheet';
import { FamilyRemovalBanner } from '../../components/FamilyRemovalBanner';
import { ProfileDetailsNudge } from '../../components/ProfileDetailsNudge';
import { useProfileDetailsNudge } from '../../hooks/useProfileDetailsNudge';
import { useFamilyRemovalBanner } from '../../hooks/useFamilyRemovalBanner';
import {
  useCaregiverViewMode,
  type CaregiverViewMode,
} from '../../hooks/useCaregiverViewMode';
import { useHydrateReadingsFromServer } from '../../hooks/useHydrateReadingsFromServer';
import { useHydrateSleepFromServer } from '../../hooks/useHydrateSleepFromServer';
import { useHydrateActivityFromServer } from '../../hooks/useHydrateActivityFromServer';
import { useHydrateHRFromServer } from '../../hooks/useHydrateHRFromServer';
import { useHydrateSpO2FromServer } from '../../hooks/useHydrateSpO2FromServer';
import { useReducedMotion } from '../../theme/useReducedMotion';
import { useTheme, type Theme } from '../../theme';
import { usePairing } from '../../state/pairing';
import { useReadings } from '../../state/readings';
import type { CaregiverStackParamList } from '../../navigation/types';
import type {
  ParentSummary,
  ReadingSummary,
} from '../../services/families/fetchParentSummaries';
import type { LocalReading } from '../../state/readings';
import { type CaregiverPerson } from '../../utils/caregiverPerson';
import {
  buildConstellationNodes,
  hasSelfNode,
  isSelfCircle,
} from '../../utils/constellationNodes';

type Nav = NativeStackNavigationProp<CaregiverStackParamList>;

// Cinematic-transition timing. Outgoing view scales+fades out; incoming
// scales+fades in. ~320ms total — short enough to feel snappy, long
// enough to read as a cinematic moment. RN doesn't support filter blur
// on Animated.View styles cross-platform, so the design's blur stage
// is dropped; opacity + scale carry the choreography.
const VIEW_TRANSITION_MS = 320;
const VIEW_TRANSITION_EASING = Easing.bezier(0.22, 1, 0.36, 1);
// 0 = bird's-eye, 1 = cards. The shared value drives both stacked views'
// opacity + scale.
const VIEW_BIRDS = 0;
const VIEW_CARDS = 1;

// Sprint 16.6 — design canopy colors (`leiko-caregiver-unified.html`).
// react-native-svg accepts hex but not CSS oklch, so these are the sRGB
// equivalents of the design's source oklch values. The base sits behind
// the SafeAreaView so the status-bar / nav-bar safe areas read as the
// same near-black warm canopy. The radial gradients are painted by the
// two bg components below.
const CAREGIVER_BG_BASE = '#060505';
const BIRDS_GLOW_INNER = '#3A2B1A'; // ≈ oklch(24% 0.04 50)
const BIRDS_GLOW_OUTER = '#0E0B08'; // ≈ oklch(10% 0.01 55)
const CARDS_BG_BASE = '#0F0C09'; //   ≈ oklch(12% 0.012 55)
const CARDS_GLOW_INNER = '#3D2D1F'; // ≈ oklch(28% 0.04 50)

export function CaregiverHome() {
  const theme = useTheme();
  const navigation = useNavigation<Nav>();
  // `people` from useCaregiverFamily is no longer consumed directly —
  // ADR-0006 Phase 2 derives ordered nodes via buildConstellationNodes
  // from `parents`/`merged` below.
  const { parents, isLoading, isRefreshing, refresh } = useCaregiverFamily();
  // Sprint 17b — detect "you were removed from a family" between
  // refetches and surface a calm banner. Backstop for the
  // `family_removed` push when push is suppressed for any reason.
  const removalBanner = useFamilyRemovalBanner(parents, isLoading);
  const pairedDevice = usePairing((s) => s.pairedDevice);
  const localLatest = useReadings((s) => s.latest());
  const {
    viewMode: viewModePref,
    setViewMode,
    hasExplicitPreference,
  } = useCaregiverViewMode();
  const reduceMotion = useReducedMotion();

  // Sprint 16.5i — caregiver-side server hydration. Pre-fix all 5
  // hydration hooks were wired ONLY in SelfBuyerHome. Caregivers (the
  // primary persona) saw stale data when the parent watch's day-info
  // storage rolled over after ~3-5 days. The hooks are no-ops when
  // local already has the FETCH_LIMIT worth of rows, so this is safe
  // to call on every mount.
  useHydrateReadingsFromServer();
  useHydrateSleepFromServer();
  useHydrateActivityFromServer();
  useHydrateHRFromServer();
  useHydrateSpO2FromServer();

  // Owning-phone first-paint merge: if local latest is newer than the
  // server view, prepend it. Same logic the legacy screen used.
  const merged = useMemo(
    () => mergeLocalLatest(parents, localLatest),
    [parents, localLatest],
  );
  // ADR-0006 Phase 2 — order nodes by urgency and flag the viewer's own
  // self-circle. buildConstellationNodes returns ConstellationNode[], a
  // superset of CaregiverPerson (adds `isSelf`), so every downstream
  // consumer (constellationPeople / legendPeople / cardData / anomaly)
  // keeps working unchanged — they now just receive an at-risk-first
  // ordering with the "You" node anchored per the focal rule.
  const mergedPeople = useMemo(
    () => buildConstellationNodes(merged, Date.now()),
    [merged],
  );
  // ADR-0006 Phase 3 — the viewer is a WEARER when they have a self-circle.
  // Only wearers get the Take-a-reading affordance (a pure caregiver never
  // takes readings — the parent does, on the watch; D8a Q-D8a-4).
  const viewerIsWearer = useMemo(() => hasSelfNode(mergedPeople), [mergedPeople]);
  const profileNudge = useProfileDetailsNudge(viewerIsWearer);

  // ADR-0006 Phase 3 — default view by how many people are in the circle.
  // Detailed (cards) reads better for 1–2 people (a sparse 2-orb sky looks
  // thin); bird's-eye earns its keep at 3+. Once the user explicitly
  // toggles, their choice wins. mergedPeople includes the self node, so a
  // solo wearer (count 1) and "you + 1 person" (count 2) both default to
  // cards; "you + 2 people" (count 3) flips to birds.
  const viewMode = useMemo<CaregiverViewMode>(() => {
    if (hasExplicitPreference) return viewModePref;
    return mergedPeople.length <= 2 ? 'cards' : 'birds';
  }, [hasExplicitPreference, viewModePref, mergedPeople.length]);

  const anomaly = useMemo(() => pickAnomalyForBanner(mergedPeople), [mergedPeople]);

  // Sprint 12 follow-up — Ask Leiko bottom sheet visibility.
  const [askLeikoVisible, setAskLeikoVisible] = useState(false);

  // Sprint 16.6 Issue #1 — accept-invite sheet for the empty-state
  // primary CTA. Reuses the shared AcceptInviteSheet component;
  // on success we refresh the family list so the constellation
  // populates without a manual reload.
  const [acceptInviteVisible, setAcceptInviteVisible] = useState(false);
  // Connect Phase B — "+ Connect" opens the one shared ConnectShareSheet
  // (zero-input code to share); "Enter a code" paths use
  // AcceptInviteSheet. Two actions, everywhere the same.
  const [careInviteVisible, setCareInviteVisible] = useState(false);

  // Sprint 14.5 task 3 — home-seeded "Worth a read" Learn card. Same
  // priority cascade as Self-Buyer Home; renders below the
  // constellation legend (bird's-eye view).
  const seededLearn = useSeededLearnCard();

  const handlePersonPress = useCallback(
    (id: string) => {
      const target = merged.find((p) => p.familyId === id);
      if (!target) return;
      // ADR-0006 Phase 2 — tapping the viewer's OWN node ("You") opens the
      // immersive personal view via ParentDashboard, which exists on this
      // (caregiver) stack and reads the self-circle's data from the server.
      // (Cross-stack routing to the self-buyer SelfBuyerHome — with its
      // Take-a-reading FAB — is the Phase 3 navigation unification; for
      // now ParentDashboard renders the full pulse for the self node too.)
      if (isSelfCircle(target)) {
        navigation.navigate('ParentDashboard', { familyId: id });
        return;
      }
      // Sprint 16.6 fix — only route to ReadingDetail when the reading
      // is in this phone's local MMKV (i.e. the caregiver IS the
      // parent — hybrid mode — and took the reading here). Cross-phone
      // readings live only on the server; ReadingDetail can't find
      // them and renders "We can't find that reading." Sprint 17a
      // routes those taps to ParentDashboard — the per-parent
      // immersive surface that replaces the Sprint 7 placeholder.
      if (target.latestReading) {
        const local = useReadings.getState().byLocalId(target.latestReading.id);
        if (local) {
          navigation.navigate('ReadingDetail', {
            readingLocalId: target.latestReading.id,
          });
          return;
        }
        navigation.navigate('ParentDashboard', { familyId: id });
        return;
      }
      // No reading yet — route based on what the user can act on. If the
      // caregiver hasn't paired their own watch yet, route to Pairing
      // (they may BE the parent in hybrid mode). Otherwise route to
      // ParentDashboard, which renders the immersive empty-state view.
      if (!pairedDevice) {
        navigation.navigate('Pairing');
        return;
      }
      navigation.navigate('ParentDashboard', { familyId: id });
    },
    [merged, navigation, pairedDevice],
  );

  // ADR-0006 Phase 3 — the viewer's own circle is the CENTRE "You" anchor,
  // not an orbiting node. Split it out so the constellation shows self in
  // the middle and only the people they care for orbit. Caregivers (no
  // self node) → selfConstellationNode is undefined and all nodes orbit,
  // exactly as before.
  const toConstellationPerson = (p: (typeof mergedPeople)[number]): ConstellationPerson => ({
    id: p.id,
    initial: p.initial,
    fullName: p.fullName,
    accent: theme.colors.person[p.accentIndex],
    status: p.status,
    bpLabel: p.bpLabel,
  });
  // The viewer's self node only earns the centre "You" anchor when it has
  // REAL data (a reading → bpLabel !== '—'). Everyone signs up with a
  // self-circle, so a caregiver who never paired a watch also has an
  // isSelf node — but showing an empty "You · no readings" at the top of
  // the screen is confusing (founder feedback). When the self node has no
  // reading we DROP it entirely: no centre anchor, and it does not orbit.
  // The centre "You" returns automatically once they pair / take a reading.
  const selfNodeData = mergedPeople.find((p) => p.isSelf);
  const selfHasReading = selfNodeData ? selfNodeData.bpLabel !== '—' : false;
  const selfConstellationNode: ConstellationPerson | undefined =
    selfNodeData && selfHasReading ? toConstellationPerson(selfNodeData) : undefined;
  const constellationPeople: ConstellationPerson[] = mergedPeople
    // Orbit everyone who isn't the self node. The empty self node (no
    // reading) is excluded here too — it neither centres nor orbits.
    .filter((p) => !p.isSelf)
    .map(toConstellationPerson);

  const legendPeople: LegendPerson[] = mergedPeople.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    relation: p.relation,
    accent: theme.colors.person[p.accentIndex],
    status: p.status,
    headline: p.headline,
  }));

  // Cinematic crossfade between the two views. A single shared value
  // (0 = birds, 1 = cards) drives both stacked views' opacity + scale.
  // Reduced motion → snap to target without the timing.
  //
  // Mount strategy: only the ACTIVE view is mounted at rest. During a
  // transition both views render (so the cross-fade is visible) and the
  // outgoing layer is unmounted on completion. This prevents the
  // inactive layer from bleeding through (Sprint 7.7b found this with
  // empty headlines visible behind the orbs) and from intercepting
  // touches on the ScrollView.
  const viewProgress = useSharedValue(viewMode === 'cards' ? VIEW_CARDS : VIEW_BIRDS);
  const [isTransitioning, setIsTransitioning] = useState(false);
  useEffect(() => {
    const target = viewMode === 'cards' ? VIEW_CARDS : VIEW_BIRDS;
    if (reduceMotion) {
      viewProgress.value = target;
      return;
    }
    setIsTransitioning(true);
    viewProgress.value = withTiming(
      target,
      { duration: VIEW_TRANSITION_MS, easing: VIEW_TRANSITION_EASING },
      (finished) => {
        if (finished) runOnJS(setIsTransitioning)(false);
      },
    );
  }, [viewMode, reduceMotion, viewProgress]);

  const birdsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - viewProgress.value,
    transform: [{ scale: 0.96 + (1 - viewProgress.value) * 0.04 }],
  }));
  const cardsAnimatedStyle = useAnimatedStyle(() => ({
    opacity: viewProgress.value,
    transform: [{ scale: 0.96 + viewProgress.value * 0.04 }],
  }));

  // Background layers fade in lockstep with the content, but opacity-only
  // (no scale) so the canopy stays anchored to the screen edges through
  // the transition. The bg layer mounts unconditionally and sits below
  // every other surface; pointer-events disabled so it never steals taps.
  const birdsBgAnimatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - viewProgress.value,
  }));
  const cardsBgAnimatedStyle = useAnimatedStyle(() => ({
    opacity: viewProgress.value,
  }));

  const showBirds = viewMode === 'birds' || isTransitioning;
  const showCards = viewMode === 'cards' || isTransitioning;

  // Editorial PersonCard data — derived per-render. The footer label is
  // generated here (not in the helper) because the format depends on
  // current local time, not just the data shape.
  const cardData = useMemo(
    () =>
      mergedPeople.map((p) => {
        const parentRow = merged.find((row) => row.familyId === p.id);
        const measuredAt = parentRow?.latestReading?.measuredAt;
        const footerLeftLabel = formatFooterLabel(measuredAt, Date.now());
        return {
          id: p.id,
          accent: theme.colors.person[p.accentIndex],
          initial: p.initial,
          fullName: p.fullName,
          relation: p.relation,
          age: p.age,
          status: p.status,
          headline: p.headline,
          sentence: p.sentence,
          vitalStrip: p.vitalStrip,
          footerLeftLabel,
        };
      }),
    [mergedPeople, merged, theme],
  );

  return (
    <SafeAreaView
      // Sprint 16.6 — design uses a near-black warm base (#060505) under
      // a layered radial-gradient canopy + ambient star field for
      // bird's-eye, and a softer warm gradient over warm-charcoal for
      // detailed. Per `leiko-caregiver-unified.html`. The bg layer below
      // is opacity-faded by `viewProgress` so the two atmospheres
      // crossfade with the content.
      style={[styles.root, { backgroundColor: CAREGIVER_BG_BASE }]}
      edges={['top', 'bottom']}
    >
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        testID="caregiver-home-bg"
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, birdsBgAnimatedStyle]}
        >
          <BirdsBackgroundSvg />
        </Animated.View>
        <Animated.View
          style={[StyleSheet.absoluteFill, cardsBgAnimatedStyle]}
        >
          <CardsBackgroundSvg />
        </Animated.View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: theme.spacing.l,
            paddingTop: theme.spacing.m,
            paddingBottom: theme.spacing.xxxxl + theme.spacing.xxl,
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
        <SharedHeader
          theme={theme}
          onSettingsPress={() => navigation.navigate('Settings')}
          onAskLeikoPress={() => setAskLeikoVisible(true)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          showToggle={merged.length > 0}
        />

        {/* Sprint 17b — surfaces when the family_owner removed this
            user from a circle. Safety net for the `family_removed`
            push. */}
        {removalBanner.removed ? (
          <FamilyRemovalBanner
            label={removalBanner.removed.label}
            onDismiss={removalBanner.dismiss}
            onEnterInvite={() => setAcceptInviteVisible(true)}
            testID="caregiver-home-removal-banner"
          />
        ) : null}

        {/* ADR-0006 — wearer-only nudge to fill the demographics the watch
            needs for accurate step/calorie counts. Self-resolves once the
            fields are set. */}
        {profileNudge.show ? (
          <ProfileDetailsNudge
            onAddDetails={() => navigation.navigate('Settings')}
            onDismiss={profileNudge.dismiss}
            testID="caregiver-home-profile-nudge"
          />
        ) : null}

        {/* Sprint 16 — calm reassurance banner after 24h of failed
            /sync. Owning phone vs caregiver phone: this mounts on
            BOTH, since either device can hit a long offline streak. */}
        <SyncReassuranceBanner testID="caregiver-home-sync-reassurance" />

        {/* Sprint 15 — server-driven anomaly banner. Most-severe across
            all family members and all 5 vitals. The legacy local-tier
            adapter `anomaly` remains as a fallback when the server has
            no event yet. */}
        <View style={{ marginTop: theme.spacing.l }}>
          <ScreenAnomalyBanner />
        </View>

        {anomaly ? (
          <View style={{ marginTop: theme.spacing.l }}>
            <AnomalyBanner
              severity={anomaly.severity}
              title={anomaly.title}
              body={anomaly.body}
              cta={{
                label: 'Open reading',
                onPress: () => handlePersonPress(anomaly.personId),
              }}
            />
          </View>
        ) : null}

        {isLoading ? (
          <Skeleton theme={theme} />
        ) : merged.length === 0 ? (
          // Connect Phase A — "invite someone yourself" used to punt to
          // Settings, where the invite row is hidden from anyone who
          // doesn't wear a watch: a dead end for exactly the people on
          // this empty state. Open the connect sheet right here.
          <EmptyNoFamily
            theme={theme}
            onEnterCode={() => setAcceptInviteVisible(true)}
            onInviteOthers={() => setCareInviteVisible(true)}
          />
        ) : (
          // Mount only the active view at rest; both render briefly during
          // the transition window so the cross-fade is visible. The
          // outgoing layer is unmounted on animation completion (see
          // `isTransitioning`). Inactive layer cannot bleed through visually
          // or intercept ScrollView gestures because it isn't in the tree.
          <View style={{ marginTop: theme.spacing.l, position: 'relative' }}>
            {showBirds ? (
              <Animated.View
                pointerEvents={viewMode === 'birds' ? 'auto' : 'none'}
                style={[
                  birdsAnimatedStyle,
                  showCards
                    ? { position: 'absolute', top: 0, left: 0, right: 0 }
                    : null,
                ]}
                testID="caregiver-home-birds-layer"
              >
                <ConstellationField
                  people={constellationPeople}
                  selfNode={selfConstellationNode}
                  onSelectPerson={handlePersonPress}
                  testID="caregiver-home-constellation"
                />
                <View style={{ marginTop: theme.spacing.xl }}>
                  <ConstellationLegend
                    people={legendPeople}
                    onSelectPerson={handlePersonPress}
                    testID="caregiver-home-legend"
                  />
                </View>

                {/* Sprint 14.5 task 3 — "Worth a read" home-seeded
                    Learn card. Renders inside the bird's-eye scroll
                    so it sits under the legend and never overlays
                    the constellation. Same priority-cascade hook as
                    Self-Buyer Home. */}
                {seededLearn.article ? (
                  <View style={{ marginTop: theme.spacing.xl }}>
                    <HomeLearnCard
                      article={seededLearn.article}
                      onArticleOpen={(id) => {
                        seededLearn.onArticleOpen(id);
                        navigation.navigate('Article', { articleId: id });
                      }}
                      onDismiss={seededLearn.onDismiss}
                      testID="caregiver-home-learn-card"
                    />
                  </View>
                ) : null}
              </Animated.View>
            ) : null}
            {showCards ? (
              <Animated.View
                pointerEvents={viewMode === 'cards' ? 'auto' : 'none'}
                style={[
                  cardsAnimatedStyle,
                  showBirds
                    ? { position: 'absolute', top: 0, left: 0, right: 0 }
                    : null,
                ]}
                testID="caregiver-home-cards-layer"
              >
                <DetailedView
                  people={cardData}
                  onSelectPerson={handlePersonPress}
                  theme={theme}
                />
              </Animated.View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {merged.length > 0 ? (
        <View
          style={{
            position: 'absolute',
            left: theme.spacing.l,
            right: theme.spacing.l,
            // Sit above the bottom tab bar when the viewer is a wearer
            // (tab bar bottom=xxl, height 60), else at the usual spot.
            bottom: viewerIsWearer
              ? theme.spacing.xxl + 60 + theme.spacing.s
              : theme.spacing.xxl,
          }}
        >
          {/* Connect Phase A — the old family_owner gate here was built
              for send-family-invite (which 403'd non-owners). The bar
              now opens the connect sheet, and connect-create is open to
              any signed-in user (ADR-0007: anyone can offer to connect),
              so co-caregivers get the affordance too. */}
          <CaregiverActionBar
            count={merged.length}
            canInvite
            onInvitePress={() => setCareInviteVisible(true)}
            testID="caregiver-home-action-bar"
          />
        </View>
      ) : null}

      {/* ADR-0006 Phase 3 — bottom navigation, wearer-only. Reuses the
          shared HomeTabBar (Home · Trends · [+ Take a reading] · Learn ·
          Settings) so the unified home matches the original self-buyer
          home's look. A pure caregiver doesn't get the tab bar (they
          don't take readings — D8a Q-D8a-4 — and reach Settings via the
          header gear). */}
      {viewerIsWearer ? (
        <HomeTabBar
          active="home"
          testID="caregiver-home-tab-bar"
          onSelect={(tab) => {
            switch (tab) {
              case 'home':
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
              case 'settings':
                navigation.navigate('Settings');
                return;
            }
          }}
        />
      ) : null}
      {/* ADR-0006 Phase 2 — the health-platform opt-in is a personal
          (self-wearer) concern and lives on the SelfBuyerHome personal
          view, reached by tapping the "You" node. It was previously
          mounted here on the assumption only caregivers see this screen
          (its account_type gate returns null for caregivers). Now that a
          self_buyer LANDS on this constellation, mounting it here opened
          its BottomSheet backdrop over the home on first run and swallowed
          all touches ("renders but taps dead"). Removed from the
          constellation; SelfBuyerHome keeps the prompt at the right altitude. */}
      {/* Sprint 10a — D8a §9.1 6th-reading auto-paywall. Fires once per
          family per month for free users; no-ops on Plus tiers. The
          host component is the only paywall mount on home — Trends
          owns its own paywall state for the explicit triggers. */}
      <SixthReadingPaywallHost
        accountType="caregiver"
        familyId={merged[0]?.familyId ?? null}
      />

      {/* Ask Leiko now lives in the header (see SharedHeader) — moved off
          a bottom FAB that collided with the Phase 3 tab bar. The sheet
          host stays here. */}
      <AskLeikoSheet
        visible={askLeikoVisible}
        onDismiss={() => setAskLeikoVisible(false)}
        onArticleOpen={(id) => navigation.navigate('Article', { articleId: id })}
      />
      {/* Sprint 16.6 Issue #1 — accept-invite sheet for the empty-state
          CTA. Mounted at the screen level so it can layer above any
          other UI; on success the family-list refresh repopulates the
          constellation and EmptyNoFamily unmounts automatically. */}
      <AcceptInviteSheet
        visible={acceptInviteVisible}
        onDismiss={() => setAcceptInviteVisible(false)}
        onSuccess={() => {
          refresh();
        }}
        testID="caregiver-home-accept"
      />
      {/* Connect Phase B — the shared zero-input share sheet. */}
      <ConnectShareSheet
        visible={careInviteVisible}
        onDismiss={() => setCareInviteVisible(false)}
        testID="caregiver-home-connect"
      />
      <QuietHoursAffirmSlot />
    </SafeAreaView>
  );
}

// Sprint 15 — one-shot quiet-hours-override affirm sheet.
function QuietHoursAffirmSlot() {
  const { visible, dismiss } = useQuietHoursAffirm();
  return <QuietHoursAffirmSheet visible={visible} onDone={dismiss} />;
}

// -----------------------------------------------------------------------------
// DetailedView — vertical stack of editorial PersonCards. Renders inside
// the cards-layer Animated.View; the parent screen handles position +
// transition. The "Three you love, checked in." headline at the top
// matches the design's leiko-caregiver-unified.html DetailedView wrapper.
// -----------------------------------------------------------------------------

interface DetailedViewProps {
  people: Array<{
    id: string;
    accent: string;
    initial: string;
    fullName: string;
    relation: string;
    age?: number;
    status: import('../../components/StatusPill').Status;
    headline: string;
    sentence: string;
    vitalStrip: { bp: string; hr: string; spo2: string; sleep: string };
    footerLeftLabel: string;
  }>;
  onSelectPerson: (id: string) => void;
  theme: Theme;
}

function DetailedView({ people, onSelectPerson, theme }: DetailedViewProps) {
  const headlineWordCount = people.length;
  const headlineWord = humanizeCount(headlineWordCount);
  const headlineStyle = theme.type('displayM');
  return (
    <View testID="caregiver-home-detailed">
      <View style={{ paddingHorizontal: theme.spacing.s, marginBottom: theme.spacing.l }}>
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: theme.fontFamilies.editorial,
            fontSize: headlineStyle.size,
            lineHeight: headlineStyle.lineHeight,
            // primary now resolves to pure #FFFFFF; the italic leading
            // word picks up secondary (warm cream #F5EFE2) so the
            // accent reads as gently warmer rather than identical.
            // Hierarchy lands on font-style + tone rather than
            // brightness drop.
            color: theme.colors.text.primary,
          }}
        >
          <Text style={{ fontStyle: 'italic', color: theme.colors.text.secondary }}>
            {headlineWord}
          </Text>
          {' you love,\nchecked in.'}
        </Text>
      </View>
      {people.map((p) => (
        <View key={p.id} style={{ marginBottom: theme.spacing.l }}>
          <PersonCard
            accent={p.accent}
            initial={p.initial}
            fullName={p.fullName}
            relation={p.relation}
            age={p.age}
            status={p.status}
            headline={p.headline}
            sentence={p.sentence}
            vitalStrip={p.vitalStrip}
            footerLeftLabel={p.footerLeftLabel}
            onPress={() => onSelectPerson(p.id)}
            testID={`caregiver-home-card-${p.id}`}
          />
        </View>
      ))}
    </View>
  );
}

const COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'] as const;
function humanizeCount(n: number): string {
  if (n >= 0 && n < COUNT_WORDS.length) return COUNT_WORDS[n];
  return String(n);
}

// -----------------------------------------------------------------------------
// SharedHeader — eyebrow + date + greeting. Mono uppercase per the design.
// -----------------------------------------------------------------------------

function SharedHeader({
  theme,
  onSettingsPress,
  onAskLeikoPress,
  viewMode,
  onViewModeChange,
  showToggle,
}: {
  theme: Theme;
  onSettingsPress: () => void;
  onAskLeikoPress: () => void;
  viewMode: CaregiverViewMode;
  onViewModeChange: (next: CaregiverViewMode) => void;
  showToggle: boolean;
}) {
  const dateLabel = useMemo(() => formatHeaderDate(new Date()), []);
  return (
    <View
      accessibilityRole="header"
      style={{ paddingHorizontal: theme.spacing.s, paddingTop: theme.spacing.s }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.m,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 9.5,
            letterSpacing: 1.9,
            color: theme.colors.brand.coral,
            textTransform: 'uppercase',
          }}
        >
          Leiko · Family
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.m }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: theme.fontFamilies.numeric,
              fontSize: 9.5,
              letterSpacing: 1.3,
              color: theme.colors.text.tertiary,
              textTransform: 'uppercase',
            }}
          >
            {dateLabel}
          </Text>
          {/* Ask Leiko — moved off a bottom FAB (it collided with the new
              tab bar) into the header as a quiet icon affordance beside
              the gear. Sparkle glyph reads as "assistant"; permanent and
              out of the bottom navigation zone. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask Leiko"
            accessibilityHint="Opens a popup to ask a question about your circle's numbers"
            onPress={onAskLeikoPress}
            hitSlop={12}
            testID="caregiver-home-ask-leiko"
            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
          >
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 18,
                color: theme.colors.brand.coral,
                lineHeight: 18,
              }}
            >
              {'✦'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={onSettingsPress}
            hitSlop={12}
            testID="caregiver-home-settings"
            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
          >
            {/* Phosphor GearSix lands when icons sweep through screens.
                Plain glyph until then — affordance still reads. */}
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 18,
                color: theme.colors.text.tertiary,
                lineHeight: 18,
              }}
            >
              {'⚙'}
            </Text>
          </Pressable>
        </View>
      </View>
      {/* Row 2: "Good morning" greeting on the left, view toggle on the
          right. Founder moved the toggle off its absolute top-right
          position (it was blocking the top of the screen) — sitting
          here inline keeps the toggle reachable as part of the
          header's natural surface without dominating the canopy. */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          minHeight: 28,
        }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: theme.fontFamilies.numeric,
            fontSize: 9,
            letterSpacing: 1.6,
            color: theme.colors.text.tertiary,
            textTransform: 'uppercase',
          }}
        >
          Good morning
        </Text>
        {showToggle ? (
          <ViewToggle
            value={viewMode}
            onChange={onViewModeChange}
            testID="caregiver-home-view-toggle"
          />
        ) : null}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// AnomalyBanner adapter — most-severe-wins across all family members.
// -----------------------------------------------------------------------------

interface BannerState {
  severity: 'calm-concerned' | 'confirmed-urgent';
  title: string;
  body: string;
  personId: string;
}

function pickAnomalyForBanner(people: CaregiverPerson[]): BannerState | null {
  // Confirmed-urgent wins outright. Otherwise, the first calm-concerned
  // person sets the banner. Order is preserved — caregiver sees the
  // earliest-listed urgent person as the "act now" surface.
  let best: BannerState | null = null;
  for (const p of people) {
    if (p.status === 'urgent') {
      const firstName = p.fullName.split(' ')[0];
      return {
        severity: 'confirmed-urgent',
        title: `Talk to ${firstName} now`,
        body: 'Their latest reading was above their usual range. A calm check-in helps.',
        personId: p.id,
      };
    }
    if (!best && p.status === 'attention') {
      const firstName = p.fullName.split(' ')[0];
      best = {
        severity: 'calm-concerned',
        title: `Worth a chat with ${firstName}`,
        body: "We've noticed a pattern worth a gentle check-in.",
        personId: p.id,
      };
    }
  }
  return best;
}

// -----------------------------------------------------------------------------
// Empty + skeleton states (preserved from the legacy screen, voice-rule-clean).
// -----------------------------------------------------------------------------

interface EmptyNoFamilyProps {
  theme: Theme;
  onEnterCode: () => void;
  onInviteOthers: () => void;
}

function EmptyNoFamily({
  theme,
  onEnterCode,
  onInviteOthers,
}: EmptyNoFamilyProps) {
  const headline = theme.type('displayM');
  const body = theme.type('bodyL');
  const label = theme.type('label');
  return (
    <View
      style={{
        marginTop: theme.spacing.xxxxl,
        paddingHorizontal: theme.spacing.xl,
        alignItems: 'center',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontFamily: theme.fontFamilies.editorial,
          fontSize: headline.size,
          lineHeight: headline.lineHeight,
          color: theme.colors.text.primary,
          textAlign: 'center',
          marginBottom: theme.spacing.m,
        }}
      >
        Your family circle is quiet for now
      </Text>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: body.size,
          lineHeight: body.lineHeight,
          fontFamily: body.family,
          textAlign: 'center',
          marginBottom: theme.spacing.xxl,
        }}
      >
        Has someone shared a Leiko code with you? Enter it and you&apos;re
        connected.
      </Text>
      <Button
        variant="primary"
        onPress={onEnterCode}
        accessibilityLabel="Enter a code"
        testID="caregiver-home-enter-code"
      >
        Enter a code
      </Button>
      <Pressable
        onPress={onInviteOthers}
        accessibilityRole="button"
        accessibilityLabel="Or share your own code"
        hitSlop={8}
        testID="caregiver-home-invite-someone"
        style={({ pressed }) => ({
          marginTop: theme.spacing.m,
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <Text
          style={{
            color: theme.colors.brand.coral,
            fontSize: label.size,
            lineHeight: label.lineHeight,
            fontFamily: label.family,
          }}
        >
          Or share your own code →
        </Text>
      </Pressable>
    </View>
  );
}

function Skeleton({ theme }: { theme: Theme }) {
  return (
    <View
      style={{
        marginTop: theme.spacing.xxl,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 320,
          height: 320,
          borderRadius: 160,
          backgroundColor: theme.colors.surface.warmSubtle,
          opacity: 0.4,
        }}
      />
    </View>
  );
}

// -----------------------------------------------------------------------------
// Helpers (re-used from the legacy screen — kept here so this file is
// self-contained; legacy file still exports the original copy).
// -----------------------------------------------------------------------------

function formatHeaderDate(d: Date): string {
  const dayName = d.toLocaleDateString(undefined, { weekday: 'long' });
  const monthName = d.toLocaleDateString(undefined, { month: 'long' });
  return `${dayName} · ${monthName} ${d.getDate()}`;
}

// Footer label for a PersonCard. Matches the design's "Read · 6:42 am"
// when the reading is recent, "Last reading · 13 hr ago" when stale,
// "No readings yet" when null. Calm, factual, voice-rule clean.
const FOOTER_STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
function formatFooterLabel(measuredAtIso: string | undefined, nowMs: number): string {
  if (!measuredAtIso) return 'No readings yet';
  const measuredAtMs = Date.parse(measuredAtIso);
  if (Number.isNaN(measuredAtMs)) return 'No readings yet';
  const ageMs = Math.max(0, nowMs - measuredAtMs);
  if (ageMs > FOOTER_STALE_THRESHOLD_MS) {
    return `Last reading · ${humanizeFooterAge(ageMs)} ago`;
  }
  const time = new Date(measuredAtMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Read · ${time}`;
}

function humanizeFooterAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// -----------------------------------------------------------------------------
// Bird's-eye + detailed background canopies. Translates the design's
// CSS `radial-gradient(...)` + ambient star-dot layer to react-native-svg.
//
// `react-native-svg`'s RadialGradient only supports a single radius `r`
// (no rx/ry — the spec extension isn't wired). The design's elliptical
// `70% 50%` gradient is approximated as a 60%-radius circle anchored at
// (50%, 35%); on a portrait-phone aspect ratio it reads visually close
// to the source ellipse. -----------------------------------------------------------------------------

function BirdsBackgroundSvg() {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <RadialGradient
          id="cg-bg-birds"
          cx="50%"
          cy="35%"
          r="60%"
          fx="50%"
          fy="35%"
        >
          <Stop offset="0%" stopColor={BIRDS_GLOW_INNER} stopOpacity={0.8} />
          <Stop offset="70%" stopColor={BIRDS_GLOW_OUTER} stopOpacity={1} />
          <Stop offset="100%" stopColor={CAREGIVER_BG_BASE} stopOpacity={1} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#cg-bg-birds)" />
      {/* Ambient star field — 7 white dots at the design's positions.
          Per-dot opacity 0.5 * 0.5 layer ≈ 0.25 effective; rendered
          directly at 0.25 here so we can drop the wrapping layer. */}
      <SvgCircle cx="20%" cy="30%" r={1}   fill="white" opacity={0.25} />
      <SvgCircle cx="70%" cy="18%" r={1}   fill="white" opacity={0.25} />
      <SvgCircle cx="40%" cy="65%" r={1}   fill="white" opacity={0.25} />
      <SvgCircle cx="85%" cy="80%" r={1}   fill="white" opacity={0.25} />
      <SvgCircle cx="12%" cy="80%" r={0.6} fill="white" opacity={0.25} />
      <SvgCircle cx="60%" cy="92%" r={0.6} fill="white" opacity={0.25} />
      <SvgCircle cx="88%" cy="40%" r={0.8} fill="white" opacity={0.25} />
    </Svg>
  );
}

function CardsBackgroundSvg() {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <RadialGradient
          id="cg-bg-cards"
          cx="50%"
          cy="0%"
          r="100%"
          fx="50%"
          fy="0%"
        >
          <Stop offset="0%" stopColor={CARDS_GLOW_INNER} stopOpacity={0.55} />
          <Stop offset="70%" stopColor={CARDS_BG_BASE} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {/* Base fill first; the gradient overlays on top so the top-of-
          screen warm glow blends into the warm-charcoal canopy. */}
      <Rect width="100%" height="100%" fill={CARDS_BG_BASE} />
      <Rect width="100%" height="100%" fill="url(#cg-bg-cards)" />
      {/* Paper-grain SVG filter is in the design but RN-SVG's
          feTurbulence support is inconsistent across iOS/Android; the
          radial canopy carries 90% of the atmosphere on its own. Grain
          can land later as a tiled PNG asset if the founder wants it. */}
    </Svg>
  );
}

export function mergeLocalLatest(
  parents: ParentSummary[],
  local: LocalReading | null,
): ParentSummary[] {
  if (!local || parents.length === 0) return parents;
  const first = parents[0];
  const firstLatestSec = first.latestReading
    ? Math.floor(Date.parse(first.latestReading.measuredAt) / 1000)
    : 0;
  if (local.measuredAtSec <= firstLatestSec) return parents;
  const localAsSummary: ReadingSummary = {
    id: local.localId,
    measuredAt: new Date(local.measuredAtSec * 1000).toISOString(),
    systolic: local.systolic,
    diastolic: local.diastolic,
    pulse: local.pulse,
    qualityScore: null,
  };
  const merged: ParentSummary = {
    ...first,
    latestReading: localAsSummary,
    recentReadings: [localAsSummary, ...first.recentReadings].slice(0, 14),
  };
  return [merged, ...parents.slice(1)];
}

export { pickAnomalyForBanner };

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
