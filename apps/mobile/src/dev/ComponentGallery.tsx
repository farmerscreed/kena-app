// Dev-only component gallery — mounted from App.tsx when __DEV__.
// Renders every Sprint 1 component × variant × state for visual review.
// The mode toggle at the top swaps between caregiver (48pt taps, smaller
// type) and parent (64pt taps, larger type). Doubles as the Sprint 1
// "demo" for the definition-of-done.
//
// Voice rules apply to every visible string here, even though this file
// is dev-only — drift in dev copy tends to migrate to production. Test
// fixtures use spec patterns: "Mum" / "Dad", verb + object CTAs, sentence
// case, no fear language.

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ListRow } from '../components/ListRow';
import { Pill } from '../components/Pill';
import { BottomSheet, type BottomSheetSize } from '../components/BottomSheet';
import { VitalRing, type VitalRingSize, type VitalRingState, type VitalType } from '../components/VitalRing';
import { AmbientPulse } from '../components/AmbientPulse';
import { VitalTile, type VitalTileState } from '../components/VitalTile';
import { DailyPulseHero, type DailyPulseHeroVitals } from '../components/DailyPulseHero';
import { CorrelationStrip } from '../components/CorrelationStrip';
import { AnomalyBanner } from '../components/AnomalyBanner';
import { Portrait, type PortraitSize } from '../components/Portrait';
import { StatusPill, type Status } from '../components/StatusPill';
import { PersonOrb } from '../components/PersonOrb';
import { ConstellationField, type ConstellationPerson } from '../components/ConstellationField';
import { ConstellationLegend, type LegendPerson } from '../components/ConstellationLegend';
import { CaregiverActionBar } from '../components/CaregiverActionBar';
import { PersonCard } from '../components/PersonCard';
import { ViewToggle } from '../components/ViewToggle';
import type { CaregiverViewMode } from '../hooks/useCaregiverViewMode';
import { useColorModeControl, useTheme, type ThemeMode } from '../theme';
import { VitalsDebugPanel } from './VitalsDebugPanel';

interface Props {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
}

// Mock data — gallery only. Voice rules apply: narrations and tile copy
// pass the forbidden-words list.
const MOCK_HERO_VITALS: DailyPulseHeroVitals = {
  bp: { fill: 0.75, state: 'filling', display: '128/82', unit: 'mmHg' },
  hr: { fill: 0.4, state: 'filling', display: '64', unit: 'bpm' },
  spo2: { fill: 0.85, state: 'filling', display: '98', unit: '%' },
  sleep: { fill: 0.6, state: 'filling', display: '7:42', unit: 'hrs' },
  activity: { fill: 0.5, state: 'filling', display: '4,166', unit: 'steps' },
};
const MOCK_HERO_VITALS_EMPTY: DailyPulseHeroVitals = {
  bp: { fill: 0, state: 'idle', display: '—', unit: 'mmHg' },
  hr: { fill: 0, state: 'idle', display: '—', unit: 'bpm' },
  spo2: { fill: 0, state: 'idle', display: '—', unit: '%' },
  sleep: { fill: 0, state: 'idle', display: '—', unit: 'hrs' },
  activity: { fill: 0, state: 'idle', display: '—', unit: 'steps' },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

// ─── Sprint 7.7 caregiver fixture (matches the design's three personas) ──────
const CAREGIVER_FIXTURE_BIRDS: ConstellationPerson[] = [
  { id: 'mom', initial: 'M', fullName: 'Marian Okeke', accent: '#FF7350', status: 'clear' as Status, bpLabel: '122/78' },
  { id: 'dad', initial: 'E', fullName: 'Emeka Okeke',  accent: '#F2A618', status: 'attention' as Status, bpLabel: '138/89' },
  { id: 'aunt', initial: 'J', fullName: 'Joy Adeyemi', accent: '#7B67CC', status: 'sleeping' as Status, bpLabel: '118/74' },
];
const CAREGIVER_FIXTURE_LEGEND: LegendPerson[] = [
  { id: 'mom', fullName: 'Marian Okeke', relation: 'Mom', accent: '#FF7350', status: 'clear' as Status, headline: 'A calm morning.' },
  { id: 'dad', fullName: 'Emeka Okeke',  relation: 'Dad', accent: '#F2A618', status: 'attention' as Status, headline: "BP is trending up." },
  { id: 'aunt', fullName: 'Joy Adeyemi', relation: 'Aunt', accent: '#7B67CC', status: 'sleeping' as Status, headline: 'Resting quietly.' },
];
const CAREGIVER_FIXTURE_CARDS = [
  {
    id: 'mom', accent: '#FF7350', initial: 'M', fullName: 'Marian Okeke', relation: 'Mom', age: 71,
    status: 'clear' as Status, headline: 'A calm morning.',
    sentence: 'BP 122/78 a moment ago. Inside the usual band.',
    vitalStrip: { bp: '122/78', hr: '64', spo2: '98%', sleep: '7:42' },
    footerLeftLabel: 'Read · 6:42 am',
  },
  {
    id: 'dad', accent: '#F2A618', initial: 'E', fullName: 'Emeka Okeke', relation: 'Dad', age: 74,
    status: 'attention' as Status, headline: 'BP is trending up.',
    sentence: 'BP 138/89 a moment ago — a little above the usual band.',
    vitalStrip: { bp: '138/89', hr: '72', spo2: '96%', sleep: '6:18' },
    footerLeftLabel: 'Read · 6:51 am',
  },
  {
    id: 'aunt', accent: '#7B67CC', initial: 'J', fullName: 'Joy Adeyemi', relation: 'Aunt', age: 68,
    status: 'sleeping' as Status, headline: 'Resting quietly.',
    sentence: 'No reading in the last 3 hr. The watch may be off the wrist.',
    vitalStrip: { bp: '118/74', hr: '58', spo2: '97%', sleep: 'now' },
    footerLeftLabel: 'Last reading · 3 hr ago',
  },
];

const MOCK_SLEEP_POINTS = Array.from({ length: 7 }, (_, i) => ({
  t: T0 + i * DAY_MS,
  value: 6.5 + Math.sin(i / 1.4) * 1.2,
}));
const MOCK_BP_POINTS = Array.from({ length: 7 }, (_, i) => ({
  t: T0 + i * DAY_MS,
  value: 124 + Math.cos(i / 1.4) * 6,
}));

export function ComponentGallery({ mode, onModeChange }: Props) {
  const theme = useTheme();
  const { override: colorOverride, setOverride: setColorOverride, resolved: resolvedColorMode } =
    useColorModeControl();
  const [largeSwitch, setLargeSwitch] = useState(false);
  const [pushSwitch, setPushSwitch] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<'today' | 'week' | 'month'>('week');
  const [sheetVisible, setSheetVisible] = useState(false);
  const [sheetSize, setSheetSize] = useState<BottomSheetSize>('default');
  const [sheetUrgent, setSheetUrgent] = useState(false);
  // Bump to remount every motion-using component so the daily-pulse-reveal
  // and live-pulse animations replay. Lets a designer review the
  // choreography without restarting the app.
  const [motionKey, setMotionKey] = useState(0);
  // Sprint 7.7 caregiver-home preview view-mode (bird's-eye ↔ cards).
  const [caregiverView, setCaregiverView] = useState<CaregiverViewMode>('birds');

  const headlineStyle = {
    fontSize: theme.type('headline').size,
    lineHeight: theme.type('headline').lineHeight,
    fontWeight: '600' as const,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.l,
  };
  const sectionTitleStyle = {
    fontSize: theme.type('title').size,
    lineHeight: theme.type('title').lineHeight,
    fontWeight: '600' as const,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing.m,
    marginTop: theme.spacing.xxxl,
  };
  const captionStyle = {
    fontSize: theme.type('caption').size,
    lineHeight: theme.type('caption').lineHeight,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.s,
  };
  const bodyStyle = {
    fontSize: theme.type('bodyL').size,
    lineHeight: theme.type('bodyL').lineHeight,
    color: theme.colors.text.primary,
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.surface.base }]}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.xxl }}>
        <Text style={headlineStyle}>Leiko design system</Text>

        {/* Type mode toggle (caregiver / parent) */}
        <Text style={captionStyle}>Type mode</Text>
        <View style={styles.modeRow}>
          <Pill
            variant="outline"
            selected={mode === 'caregiver'}
            onPress={() => onModeChange('caregiver')}
          >
            Caregiver
          </Pill>
          <View style={{ width: theme.spacing.s }} />
          <Pill
            variant="outline"
            selected={mode === 'parent'}
            onPress={() => onModeChange('parent')}
          >
            Parent
          </Pill>
        </View>
        <Text style={captionStyle}>
          {mode === 'caregiver' ? '48pt tap targets · standard type' : '64pt tap targets · larger type'}
          {theme.reduceMotion ? ' · reduced motion on' : ''}
        </Text>

        {/* Color mode toggle (system / dark / light) — D12 §12.6 */}
        <Text style={captionStyle}>Color mode</Text>
        <View style={styles.modeRow}>
          <Pill
            variant="outline"
            selected={colorOverride === 'system'}
            onPress={() => setColorOverride('system')}
          >
            System
          </Pill>
          <View style={{ width: theme.spacing.s }} />
          <Pill
            variant="outline"
            selected={colorOverride === 'dark'}
            onPress={() => setColorOverride('dark')}
          >
            Dark
          </Pill>
          <View style={{ width: theme.spacing.s }} />
          <Pill
            variant="outline"
            selected={colorOverride === 'light'}
            onPress={() => setColorOverride('light')}
          >
            Light
          </Pill>
        </View>
        <Text style={captionStyle}>
          {colorOverride === 'system'
            ? `Following OS · resolved to ${resolvedColorMode}`
            : `Forced ${resolvedColorMode}`}
        </Text>

        {/* Pill */}
        <Text style={sectionTitleStyle}>Pill</Text>
        <View style={styles.pillRow}>
          <Pill variant="neutral">Today</Pill>
          <Pill variant="info">Start here</Pill>
          <Pill variant="accent">Worth a look</Pill>
          <Pill variant="urgent">Talk to Dad now</Pill>
          <Pill variant="success">In range</Pill>
          <Pill variant="outline">Filter</Pill>
        </View>
        <Text style={captionStyle}>Selectable filter chips</Text>
        <View style={styles.pillRow}>
          {(['today', 'week', 'month'] as const).map((key) => (
            <Pill
              key={key}
              variant="outline"
              selected={selectedFilter === key}
              onPress={() => setSelectedFilter(key)}
            >
              {key === 'today' ? 'Today' : key === 'week' ? 'This week' : 'This month'}
            </Pill>
          ))}
        </View>

        {/* Card */}
        <Text style={sectionTitleStyle}>Card</Text>
        <Card>
          <Text style={bodyStyle}>Default — taupe on cream, no shadow.</Text>
        </Card>
        <View style={{ height: theme.spacing.l }} />
        <Card elevation="low">
          <Text style={bodyStyle}>Low elevation — white on cream, subtle shadow.</Text>
        </Card>
        <View style={{ height: theme.spacing.l }} />
        <Card elevation="medium">
          <Text style={bodyStyle}>Medium elevation — for sheet content.</Text>
        </Card>
        <View style={{ height: theme.spacing.l }} />
        <Card elevation="glass">
          <Text style={bodyStyle}>
            Glass elevation — material.glass.medium with BlurView.
          </Text>
        </Card>
        <View style={{ height: theme.spacing.l }} />
        <Card
          onPress={() => undefined}
          accessibilityLabel="Mum's reading card, opens reading detail"
        >
          <Text style={bodyStyle}>Tappable card — press me.</Text>
        </Card>

        {/* ListRow */}
        <Text style={sectionTitleStyle}>List row</Text>
        <Card>
          <View style={{ marginHorizontal: -theme.spacing.l, marginVertical: -theme.spacing.l }}>
            <ListRow
              variant="navigation"
              title="Notifications"
              subtitle="Daily, weekly, anomaly"
              onPress={() => undefined}
            />
            <ListRow
              variant="toggle"
              title="Large text mode"
              switchValue={largeSwitch}
              onSwitchChange={setLargeSwitch}
            />
            <ListRow
              variant="toggle"
              title="Push notifications"
              subtitle="Daily summaries and anomalies"
              switchValue={pushSwitch}
              onSwitchChange={setPushSwitch}
            />
            <ListRow variant="data" title="Phone" value="+234 800 000 0000" />
            <ListRow variant="data" title="Last reading" value="128/82 mmHg" />
            <ListRow
              variant="select"
              title="English"
              selected
              onPress={() => undefined}
            />
            <ListRow
              variant="action"
              title="Sign out"
              onPress={() => undefined}
              showDivider={false}
            />
          </View>
        </Card>
        <View style={{ height: theme.spacing.l }} />
        <Card>
          <View style={{ marginHorizontal: -theme.spacing.l, marginVertical: -theme.spacing.l }}>
            <ListRow
              variant="action"
              title="Delete account"
              destructive
              onPress={() => undefined}
              showDivider={false}
            />
          </View>
        </Card>

        {/* Button — variants */}
        <Text style={sectionTitleStyle}>Button — variants</Text>
        <View style={styles.buttonRow}>
          <Button variant="primary" onPress={() => undefined}>Pair watch</Button>
        </View>
        <View style={styles.buttonRow}>
          <Button variant="accent" onPress={() => undefined}>Add a note</Button>
        </View>
        <View style={styles.buttonRow}>
          <Button variant="secondary" onPress={() => undefined}>Add a family member</Button>
        </View>
        <View style={styles.buttonRow}>
          <Button variant="ghost" onPress={() => undefined}>Skip</Button>
        </View>
        <View style={styles.buttonRow}>
          <Button variant="destructive" onPress={() => undefined}>Sign out</Button>
        </View>

        <Text style={sectionTitleStyle}>Button — states</Text>
        <View style={styles.buttonRow}>
          <Button variant="primary" onPress={() => undefined}>Default</Button>
        </View>
        <View style={styles.buttonRow}>
          <Button variant="primary" onPress={() => undefined} loading>
            Saving
          </Button>
        </View>
        <View style={styles.buttonRow}>
          <Button variant="primary" onPress={() => undefined} disabled>
            Disabled
          </Button>
        </View>

        {/* BottomSheet — triggers */}
        <Text style={sectionTitleStyle}>Bottom sheet</Text>
        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            onPress={() => {
              setSheetSize('compact');
              setSheetUrgent(false);
              setSheetVisible(true);
            }}
          >
            Open compact
          </Button>
        </View>
        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            onPress={() => {
              setSheetSize('default');
              setSheetUrgent(false);
              setSheetVisible(true);
            }}
          >
            Open default
          </Button>
        </View>
        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            onPress={() => {
              setSheetSize('tall');
              setSheetUrgent(false);
              setSheetVisible(true);
            }}
          >
            Open tall
          </Button>
        </View>
        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            onPress={() => {
              setSheetSize('full');
              setSheetUrgent(false);
              setSheetVisible(true);
            }}
          >
            Open full
          </Button>
        </View>
        <View style={styles.buttonRow}>
          <Button
            variant="destructive"
            onPress={() => {
              setSheetSize('default');
              setSheetUrgent(true);
              setSheetVisible(true);
            }}
          >
            Open confirmed-urgent
          </Button>
        </View>

        {/* ─── Sprint 7.6 primitives ─────────────────────────────── */}

        <Text style={sectionTitleStyle}>Sprint 7.6 — multi-vitals primitives</Text>
        <Text style={captionStyle}>
          Tap "Replay motion" to remount every animated component so the
          daily-pulse-reveal + live-pulse choreography plays from scratch.
        </Text>
        <View style={styles.buttonRow}>
          <Button
            variant="secondary"
            onPress={() => setMotionKey((k) => k + 1)}
          >
            Replay motion
          </Button>
        </View>

        {/* VitalRing */}
        <Text style={sectionTitleStyle}>VitalRing — sizes</Text>
        <View style={styles.ringRow}>
          {(['sm', 'md', 'lg', 'hero'] as VitalRingSize[]).map((size) => (
            <VitalRing
              key={`size-${size}-${motionKey}`}
              vitalType="bp"
              fill={0.62}
              size={size}
              state="filling"
            />
          ))}
        </View>
        <Text style={sectionTitleStyle}>VitalRing — states (md, BP)</Text>
        <View style={styles.ringRow}>
          {(['idle', 'filling', 'pulsing', 'stale'] as VitalRingState[]).map(
            (s) => (
              <View key={`state-${s}-${motionKey}`} style={{ alignItems: 'center' }}>
                <VitalRing vitalType="bp" fill={0.62} state={s} />
                <Text style={[captionStyle, { marginTop: theme.spacing.xs }]}>
                  {s}
                </Text>
              </View>
            ),
          )}
        </View>
        <Text style={sectionTitleStyle}>VitalRing — vital types (md)</Text>
        <View style={styles.ringRow}>
          {(['bp', 'hr', 'spo2', 'sleep', 'activity'] as VitalType[]).map(
            (v) => (
              <View key={`vital-${v}`} style={{ alignItems: 'center' }}>
                <VitalRing vitalType={v} fill={0.5} state="idle" />
                <Text style={[captionStyle, { marginTop: theme.spacing.xs }]}>
                  {v}
                </Text>
              </View>
            ),
          )}
        </View>

        {/* AmbientPulse */}
        <Text style={sectionTitleStyle}>AmbientPulse — wraps any element</Text>
        <View style={styles.ringRow}>
          <AmbientPulse key={`ap-${motionKey}`} active bpm={62}>
            <Card>
              <Text style={bodyStyle}>Live HR — pulsing wrapper</Text>
            </Card>
          </AmbientPulse>
        </View>

        {/* VitalTile */}
        <Text style={sectionTitleStyle}>VitalTile — states (BP)</Text>
        {(['normal', 'live', 'stale', 'no-data'] as VitalTileState[]).map(
          (s) => (
            <View key={`tile-${s}-${motionKey}`} style={{ marginBottom: theme.spacing.l }}>
              <Text style={captionStyle}>state = {s}</Text>
              <VitalTile
                vitalType="bp"
                value={s === 'no-data' ? '—' : '128/82'}
                secondary={s === 'stale' ? 'Last sync 4h ago' : 'morning'}
                state={s}
                ringFill={0.62}
                onPress={() => undefined}
              />
            </View>
          ),
        )}
        <Text style={sectionTitleStyle}>VitalTile — vital types (normal)</Text>
        {(
          [
            { type: 'hr' as VitalType, value: '62 bpm', sub: 'resting' },
            { type: 'spo2' as VitalType, value: '97%', sub: 'last reading' },
            { type: 'sleep' as VitalType, value: '7h 24m', sub: 'last night' },
            { type: 'activity' as VitalType, value: '8,432', sub: 'steps today' },
          ]
        ).map(({ type, value, sub }) => (
          <View key={`tile-vital-${type}`} style={{ marginBottom: theme.spacing.l }}>
            <VitalTile
              vitalType={type}
              value={value}
              secondary={sub}
              state="normal"
              ringFill={0.55}
              onPress={() => undefined}
            />
          </View>
        ))}

        {/* DailyPulseHero — constellation (1 central BP + 4 satellites) */}
        <Text style={sectionTitleStyle}>DailyPulseHero — constellation</Text>
        <DailyPulseHero
          key={`hero-immersive-${motionKey}`}
          vitals={MOCK_HERO_VITALS}
          central={{
            label: 'Blood pressure',
            value: '128/82',
            sub: 'mmHg · 6:42 am',
          }}
          aiNarration="Mum is in her usual range. 124/79 this morning, six below her week."
          parentName="Mum"
        />
        <View style={{ height: theme.spacing.xxl }} />

        {/* DailyPulseHero — adaptive central branches */}
        <Text style={sectionTitleStyle}>DailyPulseHero — adaptive central</Text>
        <View style={{ marginBottom: theme.spacing.l }}>
          <Text style={captionStyle}>HR fallback (no fresh BP)</Text>
          <DailyPulseHero
            key={`hero-hr-${motionKey}`}
            vitals={MOCK_HERO_VITALS}
            central={{ label: 'Resting HR', value: '62', sub: 'bpm · resting' }}
          />
        </View>
        <View style={{ marginBottom: theme.spacing.l }}>
          <Text style={captionStyle}>Sleep fallback (no BP, no HR today)</Text>
          <DailyPulseHero
            key={`hero-sleep-${motionKey}`}
            vitals={MOCK_HERO_VITALS}
            central={{ label: 'Last night', value: '7h 24m', sub: 'sleep' }}
          />
        </View>
        <View style={{ marginBottom: theme.spacing.l }}>
          <Text style={captionStyle}>None — first-open of the day</Text>
          <DailyPulseHero
            key={`hero-none-${motionKey}`}
            vitals={MOCK_HERO_VITALS_EMPTY}
            central={{ label: 'No readings yet today', value: '—' }}
          />
        </View>

        {/* CorrelationStrip */}
        <Text style={sectionTitleStyle}>CorrelationStrip — Sleep × Morning BP</Text>
        <Card>
          <CorrelationStrip
            key={`corr-${motionKey}`}
            vitalA={{ type: 'sleep', points: MOCK_SLEEP_POINTS }}
            vitalB={{ type: 'bp', points: MOCK_BP_POINTS }}
            range="7d"
            caption="Sleep × Morning BP"
          />
        </Card>
        <View style={{ height: theme.spacing.l }} />

        {/* AnomalyBanner */}
        <Text style={sectionTitleStyle}>AnomalyBanner — calm-concerned</Text>
        <AnomalyBanner
          key={`banner-calm-${motionKey}`}
          severity="calm-concerned"
          title="Worth a chat with Mum"
          body="We've noticed a pattern worth a gentle check-in."
          cta={{ label: 'Open reading', onPress: () => undefined }}
          onDismiss={() => undefined}
        />
        <View style={{ height: theme.spacing.l }} />
        <Text style={sectionTitleStyle}>AnomalyBanner — confirmed-urgent</Text>
        <AnomalyBanner
          key={`banner-urgent-${motionKey}`}
          severity="confirmed-urgent"
          title="Talk to Mum now"
          body="Their latest reading was above their usual range. A calm check-in helps."
          cta={{ label: 'Call Mum', onPress: () => undefined }}
        />

        {/* ─── Sprint 7.7 — Caregiver Family Constellation ─────────── */}

        <Text style={sectionTitleStyle}>Sprint 7.7 — caregiver Family Constellation</Text>
        <Text style={captionStyle}>
          The full caregiver-home composition. Tap the toggle to switch between
          bird's-eye orbs and editorial cards. Three-person fixture (Mom clear /
          Dad attention / Aunt sleeping) — same cast as the design.
        </Text>

        {/* Toggle + bird's-eye */}
        <View style={{ marginBottom: theme.spacing.l, alignItems: 'flex-end' }}>
          <ViewToggle value={caregiverView} onChange={setCaregiverView} />
        </View>

        {caregiverView === 'birds' ? (
          <View key={`birds-${motionKey}`}>
            <ConstellationField
              people={CAREGIVER_FIXTURE_BIRDS}
              onSelectPerson={() => undefined}
            />
            <View style={{ marginTop: theme.spacing.xl }}>
              <ConstellationLegend
                people={CAREGIVER_FIXTURE_LEGEND}
                onSelectPerson={() => undefined}
              />
            </View>
          </View>
        ) : (
          <View key={`cards-${motionKey}`}>
            {CAREGIVER_FIXTURE_CARDS.map((p) => (
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
                  onPress={() => undefined}
                />
              </View>
            ))}
          </View>
        )}

        <View style={{ marginTop: theme.spacing.xl, marginBottom: theme.spacing.xl }}>
          <CaregiverActionBar count={3} canInvite onInvitePress={() => undefined} />
        </View>

        {/* Sprint 7.7 component primitives */}
        <Text style={sectionTitleStyle}>Sprint 7.7 — primitives</Text>

        <Text style={captionStyle}>Portrait — sm / md / lg × three accents</Text>
        <View style={styles.ringRow}>
          {(['sm', 'md', 'lg'] as PortraitSize[]).map((size) => (
            <View key={size} style={{ flexDirection: 'row', gap: 8 }}>
              <Portrait initial="M" accent="#FF7350" size={size} />
              <Portrait initial="E" accent="#F2A618" size={size} />
              <Portrait initial="J" accent="#7B67CC" size={size} />
            </View>
          ))}
        </View>

        <Text style={captionStyle}>StatusPill — six states</Text>
        <View style={styles.ringRow}>
          {(['clear', 'watch', 'attention', 'urgent', 'offline', 'sleeping'] as Status[]).map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </View>

        <Text style={captionStyle}>PersonOrb — six states (single orb)</Text>
        <View style={styles.ringRow}>
          {(['clear', 'watch', 'attention', 'urgent', 'offline', 'sleeping'] as Status[]).map((s, i) => (
            <View key={`orb-${s}-${motionKey}`} style={{ width: 110, alignItems: 'center', marginBottom: theme.spacing.xl }}>
              <PersonOrb
                initial="M"
                accent="#FF7350"
                status={s}
                fullName="Marian Okeke"
                bpLabel="122/78"
                staggerIndex={i}
                onPress={() => undefined}
              />
            </View>
          ))}
        </View>

        <VitalsDebugPanel />

        <View style={{ height: theme.spacing.xxxxl }} />
      </ScrollView>

      <BottomSheet
        visible={sheetVisible}
        onDismiss={() => setSheetVisible(false)}
        size={sheetSize}
        confirmedUrgent={sheetUrgent}
        title={sheetUrgent ? 'Please call Dad' : 'Add a note'}
      >
        <Text style={bodyStyle}>
          {sheetUrgent
            ? 'Three high readings in the last hour. We recommend reaching out now.'
            : 'Notes are visible to everyone in the family circle. Tap and hold to edit.'}
        </Text>
        {sheetUrgent ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <Button variant="primary" onPress={() => setSheetVisible(false)}>
              I&apos;ve called
            </Button>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  modeRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  buttonRow: {
    marginBottom: 12,
  },
  ringRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
});
