// TakeReadingScreen — Sprint 6.
//
// Per docs/04-screens/take-reading.md and Option 1 of the Sprint 6
// proposal: the U16PRO protocol has no remote-trigger BP command, so
// the in-app CTA does NOT inflate the cuff. Instead the screen:
//   1. Connects to the persisted watch (begin()).
//   2. Shows instructional copy: "Press the BP button on your watch —
//      we'll catch the result here."
//   3. Listens for 0x73 0x02 → fetches via 0x14 → renders success.
//
// The "Add a manual reading" secondary path opens a BottomSheet with
// sys/dia/pulse inputs (D6 US-26). Used when the watch isn't on the
// wrist.
//
// Visual rules per CLAUDE.md anti-patterns:
//   - Spec calls for the primary CTA to be larger than other CTAs;
//     we honour that on the failure-state retry button.
//   - No fear language. No "alert", no "warning", no urgency colour
//     unless tier=confirmed_urgent (in which case Pill carries it).
//   - Reduced motion respected via the BottomSheet animation tokens.

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';
import { useTheme } from '../../theme';
import { useAnnounceOnChange } from '../../hooks/useAnnounce';
import { useTakeReading } from '../../state/takeReading';
import { useReadings } from '../../state/readings';
import {
  tierChipText,
  tierPillVariant,
} from '../../utils/classification';
import type { CaregiverScreenProps } from '../../navigation/types';

type Props =
  | CaregiverScreenProps<'TakeReading'>
  | {
      navigation: {
        goBack: () => void;
        navigate: (r: string, p?: object) => void;
        // Sprint 18 bench bug — added so onContinueToDetail can replace
        // (not push) ReadingDetail onto the stack, leaving the back
        // affordance pointing at Home rather than at the just-finished
        // TakeReading wizard.
        replace?: (r: string, p?: object) => void;
      };
    };

export function TakeReadingScreen({ navigation }: Props) {
  const theme = useTheme();
  const phase = useTakeReading((s) => s.phase);
  const error = useTakeReading((s) => s.error);
  const lastReadingId = useTakeReading((s) => s.lastReadingId);
  const begin = useTakeReading((s) => s.begin);
  const cancel = useTakeReading((s) => s.cancel);
  const retry = useTakeReading((s) => s.retry);
  const reset = useTakeReading((s) => s.reset);
  const readingsHydrate = useReadings((s) => s.hydrate);

  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    readingsHydrate();
    void begin();
    return () => reset();
  }, [begin, reset, readingsHydrate]);

  const onClose = () => {
    void cancel();
    navigation.goBack();
  };

  const onContinueToDetail = () => {
    if (!lastReadingId) {
      navigation.goBack();
      return;
    }
    // Sprint 18 bench bug — replace TakeReading with ReadingDetail on
    // the stack instead of pushing. Otherwise the user lands on
    // ReadingDetail with no obvious exit (Back returns to the success
    // view of TakeReading, not Home). With replace, Back from
    // ReadingDetail goes straight to Home.
    const nav = navigation as {
      navigate: (r: string, p?: object) => void;
      replace?: (r: string, p?: object) => void;
    };
    const target = nav.replace ?? nav.navigate;
    target('ReadingDetail', { readingLocalId: lastReadingId });
  };

  let body: React.ReactNode;
  switch (phase) {
    case 'idle':
    case 'connecting':
      body = <ConnectingView />;
      break;
    case 'waiting_for_watch':
      body = (
        <WaitingForWatchView
          onCancel={onClose}
          onManualEntry={() => setManualOpen(true)}
        />
      );
      break;
    case 'reconnecting':
      body = <ReconnectingView />;
      break;
    case 'fetching':
      body = <FetchingView />;
      break;
    case 'success':
      body = (
        <SuccessView
          onDone={onContinueToDetail}
          onTakeAnother={() => void retry()}
        />
      );
      break;
    case 'failure':
      body = (
        <FailureView
          friendly={error?.friendly ?? "Something got in the way. Try again?"}
          onRetry={() => void retry()}
          onCancel={onClose}
        />
      );
      break;
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.base }]}
      edges={['top', 'bottom']}
      testID="take-reading-screen"
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: theme.spacing.xxl,
            paddingTop: theme.spacing.xxl,
            paddingBottom: theme.spacing.xxxl,
          },
        ]}
      >
        {body}
      </ScrollView>
      <ManualEntrySheet
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        onSaved={onContinueToDetail}
      />
    </SafeAreaView>
  );
}

// ─── views ──────────────────────────────────────────────────────────

function Headline({ children }: { children: string }) {
  const theme = useTheme();
  const t = theme.type('displayM');
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.colors.text.primary,
        fontSize: t.size,
        lineHeight: t.lineHeight,
        fontWeight: t.weight as '700',
        fontFamily: t.family,
        marginBottom: theme.spacing.s,
      }}
    >
      {children}
    </Text>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const t = theme.type('bodyL');
  return (
    <Text
      style={{
        color: theme.colors.text.secondary,
        fontSize: t.size,
        lineHeight: t.lineHeight,
        fontFamily: t.family,
        marginBottom: theme.spacing.l,
      }}
    >
      {children}
    </Text>
  );
}

// Audit P1-7 — every phase of this state machine carried an Android-only
// accessibilityLiveRegion, so on iOS the whole measurement flow was silent.
// Each view now declares one sentence, hands it to both the live region
// (Android) and useAnnounceOnChange (iOS), so the two can't drift apart.
// The sentences are user-visible copy: complete, calm, voice-rule clean
// (docs/05-voice-and-claims.md).
const A11Y_CONNECTING =
  'Reaching the watch. This usually takes a couple of seconds.';
const A11Y_WAITING =
  "Press the BP button on your watch. Sit still while it takes the reading — we'll catch the result here.";
const A11Y_RECONNECTING = 'One moment. Picking up the new reading from your watch.';
const A11Y_FETCHING = 'Reading complete. Saving it now.';

function ConnectingView() {
  const theme = useTheme();
  // Audit P1-7.
  useAnnounceOnChange(A11Y_CONNECTING);
  return (
    <View accessible={true}
      testID="take-reading-connecting"
      accessibilityLiveRegion="polite"
      accessibilityLabel={A11Y_CONNECTING}
    >
      <Headline>Reaching the watch</Headline>
      <Body>This usually takes a couple of seconds.</Body>
      <View style={{ alignItems: 'center', marginVertical: theme.spacing.xxl }}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
    </View>
  );
}

function WaitingForWatchView({
  onCancel,
  onManualEntry,
}: {
  onCancel: () => void;
  onManualEntry: () => void;
}) {
  const theme = useTheme();
  // Audit P1-7.
  useAnnounceOnChange(A11Y_WAITING);
  return (
    <View accessible={true}
      testID="take-reading-waiting"
      accessibilityLiveRegion="polite"
      accessibilityLabel={A11Y_WAITING}
    >
      <Headline>Press the BP button on your watch</Headline>
      <Body>
        Sit still while the watch inflates and takes the reading. We'll catch the
        result here.
      </Body>
      <Button
        variant="ghost"
        onPress={onManualEntry}
        accessibilityLabel="Add a manual reading"
        testID="take-reading-manual-cta"
        style={{ marginTop: theme.spacing.l }}
      >
        Add a manual reading
      </Button>
      <Button
        variant="ghost"
        onPress={onCancel}
        accessibilityLabel="Cancel"
        testID="take-reading-cancel"
        style={{ marginTop: theme.spacing.s }}
      >
        Cancel
      </Button>
    </View>
  );
}

function ReconnectingView() {
  const theme = useTheme();
  // Audit P1-7.
  useAnnounceOnChange(A11Y_RECONNECTING);
  return (
    <View accessible={true}
      testID="take-reading-reconnecting"
      accessibilityLiveRegion="polite"
      accessibilityLabel={A11Y_RECONNECTING}
    >
      <Headline>One moment</Headline>
      <Body>Picking up the new reading from your watch.</Body>
      <View style={{ alignItems: 'center', marginVertical: theme.spacing.xxl }}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
    </View>
  );
}

function FetchingView() {
  const theme = useTheme();
  // Audit P1-7.
  useAnnounceOnChange(A11Y_FETCHING);
  return (
    <View accessible={true}
      testID="take-reading-fetching"
      accessibilityLiveRegion="polite"
      accessibilityLabel={A11Y_FETCHING}
    >
      <Headline>Reading complete</Headline>
      <Body>Saving — one moment.</Body>
      <View style={{ alignItems: 'center', marginVertical: theme.spacing.xxl }}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
    </View>
  );
}

function SuccessView({
  onDone,
  onTakeAnother,
}: {
  onDone: () => void;
  onTakeAnother: () => void;
}) {
  const theme = useTheme();
  const reading = useReadings((s) => (s.latest()));
  const numericXl = theme.type('numericXl');
  const bodyM = theme.type('bodyM');

  const a11yLabel = reading
    ? `Reading saved. ${reading.systolic} over ${reading.diastolic} mmHg, pulse ${reading.pulse ?? 'unknown'}.`
    : null;
  // Audit P1-7 — hook runs before the early return so hook order stays
  // stable across the fetching → success transition.
  useAnnounceOnChange(a11yLabel);

  if (!reading) return <FetchingView />;

  return (
    <View accessible={true}
      testID="take-reading-success"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={a11yLabel ?? undefined}
    >
      <Headline>Saved</Headline>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'center',
          marginVertical: theme.spacing.xxl,
        }}
      >
        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: numericXl.size,
            lineHeight: numericXl.lineHeight,
            fontWeight: numericXl.weight as '500',
            fontFamily: numericXl.family,
          }}
        >
          {reading.systolic}/{reading.diastolic}
        </Text>
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: bodyM.size,
            fontFamily: bodyM.family,
            marginLeft: theme.spacing.s,
          }}
        >
          mmHg
        </Text>
      </View>
      <View style={{ alignItems: 'center', marginBottom: theme.spacing.xxl }}>
        <Pill variant={tierPillVariant(reading.classification.tier)}>
          {tierChipText(reading.classification.tier)}
        </Pill>
      </View>
      <Button
        variant="primary"
        onPress={onDone}
        accessibilityLabel="See the full reading"
        testID="take-reading-done"
      >
        See the full reading
      </Button>
      <Button
        variant="ghost"
        onPress={onTakeAnother}
        accessibilityLabel="Take another reading"
        testID="take-reading-another"
        style={{ marginTop: theme.spacing.s }}
      >
        Take another reading
      </Button>
    </View>
  );
}

function FailureView({
  friendly,
  onRetry,
  onCancel,
}: {
  friendly: string;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  // Audit P1-7 — this view had no live region at all, on either platform.
  // Both halves added: assertive on Android, announced on iOS.
  const a11yLabel = `We couldn't get that reading. ${friendly}`;
  useAnnounceOnChange(a11yLabel);
  return (
    <View accessible={true}
      testID="take-reading-failure"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={a11yLabel}
    >
      <Headline>We couldn't get that reading</Headline>
      <Body>{friendly}</Body>
      <Button
        variant="primary"
        onPress={onRetry}
        accessibilityLabel="Try again"
        testID="take-reading-retry"
        style={{ marginTop: theme.spacing.l }}
      >
        Try again
      </Button>
      <Button
        variant="ghost"
        onPress={onCancel}
        accessibilityLabel="Not now"
        testID="take-reading-cancel"
        style={{ marginTop: theme.spacing.s }}
      >
        Not now
      </Button>
    </View>
  );
}

// ─── Manual entry (D6 US-26) ────────────────────────────────────────

function ManualEntrySheet({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const theme = useTheme();
  const addManualReading = useTakeReading((s) => s.addManualReading);
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Audit P1-7 — the inline validation error below is an Android-only live
  // region. On iOS the form silently refused to submit.
  useAnnounceOnChange(error);

  const reset = () => {
    setSys('');
    setDia('');
    setPulse('');
    setError(null);
  };

  const onSubmit = () => {
    const sysN = Number.parseInt(sys, 10);
    const diaN = Number.parseInt(dia, 10);
    const pulseN = pulse.trim() === '' ? null : Number.parseInt(pulse, 10);
    if (!Number.isFinite(sysN) || sysN < 30 || sysN > 300) {
      setError('Top number should be between 30 and 300.');
      return;
    }
    if (!Number.isFinite(diaN) || diaN < 20 || diaN > 200) {
      setError('Bottom number should be between 20 and 200.');
      return;
    }
    if (pulseN !== null && (!Number.isFinite(pulseN) || pulseN < 30 || pulseN > 240)) {
      setError('Pulse should be between 30 and 240, or leave it blank.');
      return;
    }
    addManualReading({ systolic: sysN, diastolic: diaN, pulse: pulseN });
    reset();
    onClose();
    onSaved();
  };

  const labelStyle = {
    color: theme.colors.text.secondary,
    fontSize: theme.type('label').size,
    fontFamily: theme.type('label').family,
    marginBottom: theme.spacing.xs,
  };
  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing.l,
    paddingVertical: theme.spacing.m,
    color: theme.colors.text.primary,
    fontSize: theme.type('bodyL').size,
    fontFamily: theme.type('bodyL').family,
    marginBottom: theme.spacing.l,
  } as const;

  return (
    <BottomSheet
      visible={visible}
      onDismiss={() => {
        reset();
        onClose();
      }}
      size="default"
      title="Add a manual reading"
      testID="take-reading-manual-sheet"
    >
      <Text style={labelStyle}>Top number (systolic)</Text>
      <TextInput
        accessibilityLabel="Top number, systolic"
        testID="take-reading-manual-sys"
        keyboardType="number-pad"
        value={sys}
        onChangeText={(t) => { setSys(t); setError(null); }}
        style={inputStyle}
      />
      <Text style={labelStyle}>Bottom number (diastolic)</Text>
      <TextInput
        accessibilityLabel="Bottom number, diastolic"
        testID="take-reading-manual-dia"
        keyboardType="number-pad"
        value={dia}
        onChangeText={(t) => { setDia(t); setError(null); }}
        style={inputStyle}
      />
      <Text style={labelStyle}>Pulse (optional)</Text>
      <TextInput
        accessibilityLabel="Pulse, optional"
        testID="take-reading-manual-pulse"
        keyboardType="number-pad"
        value={pulse}
        onChangeText={(t) => { setPulse(t); setError(null); }}
        style={inputStyle}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          testID="take-reading-manual-error"
          style={{
            color: theme.colors.state.urgent,
            fontSize: theme.type('bodyM').size,
            fontFamily: theme.type('bodyM').family,
            marginBottom: theme.spacing.l,
          }}
        >
          {error}
        </Text>
      ) : null}
      <Button
        variant="primary"
        onPress={onSubmit}
        accessibilityLabel="Save reading"
        testID="take-reading-manual-save"
      >
        Save reading
      </Button>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
