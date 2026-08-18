// PairingScreen — Sprint 5.
//
// Renders the entire watch-pairing flow as one navigable route. The
// store (state/pairing.ts) drives a phase enum; each phase maps to a
// small inline view component. We keep the views co-located in this
// file so the relationship between phases and rendered UI is one read,
// not nine. Per docs/04-screens/watch-pairing.md.
//
// Visual rules (CLAUDE.md anti-patterns + docs/02-design-tokens.md):
// - No red on any normal-state UI (failure surface uses amber, not crimson).
// - "Pair this watch" CTA stays at the spec-mandated default size.
// - All animation is functional; no decorative loops.

import { useEffect } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { BatteryOptimizationPrompt } from '../../components/BatteryOptimizationPrompt';
import { useTheme } from '../../theme';
import { useAnnounceOnChange } from '../../hooks/useAnnounce';
import { usePairing, supportsWebBluetoothHandoff } from '../../state/pairing';
import { useOnboarding } from '../../state/onboarding';
import type { CaregiverScreenProps } from '../../navigation/types';

type Props =
  | CaregiverScreenProps<'Pairing'>
  | { navigation: { goBack: () => void; popToTop?: () => void } };

export function PairingScreen({ navigation }: Props) {
  const theme = useTheme();
  const phase = usePairing((s) => s.phase);
  const beginPairing = usePairing((s) => s.beginPairing);
  const reset = usePairing((s) => s.reset);

  // Enter the flow via permission_prime on mount; reset on unmount so
  // the next entry starts clean.
  useEffect(() => {
    void beginPairing();
    return () => reset();
  }, [beginPairing, reset]);

  let body: React.ReactNode;
  switch (phase) {
    case 'idle':
    case 'permission_prime':
      body = <PermissionPrimeView />;
      break;
    case 'permission_denied':
      body = <PermissionDeniedView onCancel={() => navigation.goBack()} />;
      break;
    case 'bluetooth_off':
      body = <BluetoothOffView onCancel={() => navigation.goBack()} />;
      break;
    case 'power_on':
      body = <PowerOnView onCancel={() => navigation.goBack()} />;
      break;
    case 'searching':
      body = <SearchingView onCancel={() => navigation.goBack()} />;
      break;
    case 'found':
      body = <FoundView onCancel={() => navigation.goBack()} />;
      break;
    case 'pairing':
      body = <PairingView />;
      break;
    case 'success':
      body = <SuccessView onContinue={() => navigation.goBack()} />;
      break;
    case 'failure':
      body = <FailureView onCancel={() => navigation.goBack()} />;
      break;
  }

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.base }]}
      edges={['top', 'bottom']}
      testID="pairing-screen"
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
      {/* Post-pairing: once the watch is connected, offer to exempt Leiko
          from battery optimization so remote-refresh can wake the phone in
          the background. Self-gates (no-op if already exempt / dismissed /
          not Android). */}
      {phase === 'success' && <BatteryOptimizationPrompt />}
    </SafeAreaView>
  );
}

// ─── shared sub-components ───────────────────────────────────────────

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

function Body({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  const theme = useTheme();
  const t = theme.type('bodyL');
  return (
    <Text
      style={{
        color: muted ? theme.colors.text.secondary : theme.colors.text.primary,
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

// ─── views per phase ─────────────────────────────────────────────────

// Audit P1-7 — the pairing phases carried Android-only
// accessibilityLiveRegion props, so on iOS the flow ran silently: no
// "we're looking", no "we found it", no "it's paired". Each phase now
// declares one sentence used by both the live region (Android) and
// useAnnounceOnChange (iOS). The old labels ("Searching for watch",
// "Pairing", "Paired") read as debug strings; these are complete,
// calm sentences per docs/05-voice-and-claims.md.
const A11Y_SEARCHING =
  'Looking for the watch. This usually takes a few seconds.';
const A11Y_PAIRING = 'Talking to the watch. Hang on — almost there.';

function PermissionPrimeView() {
  const theme = useTheme();
  const acknowledgePermissions = usePairing((s) => s.acknowledgePermissions);
  return (
    <View testID="pairing-permission-prime">
      <Headline>One quick permission</Headline>
      <Body muted>
        We use Bluetooth to talk to the watch. We don't use it for anything else.
      </Body>
      <Button
        variant="primary"
        onPress={() => void acknowledgePermissions()}
        accessibilityLabel="Continue"
        testID="pairing-permission-continue"
        style={{ marginTop: theme.spacing.l }}
      >
        Continue
      </Button>
    </View>
  );
}

function PowerOnView({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  const confirmWatchOn = usePairing((s) => s.confirmWatchOn);
  return (
    <View testID="pairing-power-on">
      <Headline>Make sure the watch is on</Headline>
      <Body muted>
        Tap the side button if the screen is dark. We'll find it next.
      </Body>
      <Button
        variant="primary"
        onPress={() => void confirmWatchOn()}
        accessibilityLabel="It is on"
        testID="pairing-power-on-confirm"
        style={{ marginTop: theme.spacing.l }}
      >
        It's on
      </Button>
      <CancelLink onCancel={onCancel} />
    </View>
  );
}

function SearchingView({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  const stopScan = usePairing((s) => s.stopScan);
  // Audit P1-7.
  useAnnounceOnChange(A11Y_SEARCHING);
  return (
    <View
      testID="pairing-searching"
      accessibilityLiveRegion="polite"
      accessibilityLabel={A11Y_SEARCHING}
    >
      <Headline>Looking for the watch</Headline>
      <Body muted>This usually takes a few seconds.</Body>
      <View style={{ alignItems: 'center', marginVertical: theme.spacing.xxl }}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
      <Button
        variant="ghost"
        onPress={() => {
          stopScan();
          onCancel();
        }}
        accessibilityLabel="Cancel"
        testID="pairing-searching-cancel"
      >
        Cancel
      </Button>
    </View>
  );
}

function FoundView({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  const discovered = usePairing((s) => s.discovered);
  const selectedBleId = usePairing((s) => s.selectedBleId);
  const selectDevice = usePairing((s) => s.selectDevice);
  const buzzSelected = usePairing((s) => s.buzzSelected);
  const confirmPair = usePairing((s) => s.confirmPair);
  const title = theme.type('title');
  const body = theme.type('bodyM');
  return (
    <View testID="pairing-found">
      <Headline>
        {discovered.length === 1 ? 'Found it' : 'Found a few'}
      </Headline>
      <Body muted>
        {discovered.length === 1
          ? "Tap pair when you're ready."
          : "Pick the one you'd like to use. Tap 'Make it buzz' to be sure."}
      </Body>
      {discovered.map((device) => {
        const selected = device.bleId === selectedBleId;
        return (
          <Card
            key={device.bleId}
            elevation="low"
            onPress={() => void selectDevice(device.bleId)}
            accessibilityLabel={`Watch ending ${device.macSuffix}`}
            testID={`pairing-found-device-${device.macSuffix}`}
            style={{
              marginBottom: theme.spacing.l,
              borderColor: selected
                ? theme.colors.border.strong
                : theme.colors.border.default,
              borderWidth: selected ? 2 : 1,
            }}
          >
            <Text
              style={{
                color: theme.colors.text.primary,
                fontSize: title.size,
                lineHeight: title.lineHeight,
                fontWeight: title.weight as '600',
                fontFamily: title.family,
                marginBottom: theme.spacing.xs,
              }}
            >
              {device.name ?? 'Leiko Watch'}
            </Text>
            <Text
              style={{
                color: theme.colors.text.secondary,
                fontSize: body.size,
                fontFamily: body.family,
              }}
            >
              Ending {device.macSuffix}
            </Text>
          </Card>
        );
      })}
      {selectedBleId ? (
        <>
          <Button
            variant="primary"
            onPress={() => void confirmPair()}
            accessibilityLabel="Pair this watch"
            testID="pairing-found-confirm"
            style={{ marginTop: theme.spacing.s }}
          >
            Pair this watch
          </Button>
          <Button
            variant="ghost"
            onPress={() => void buzzSelected()}
            accessibilityLabel="Make it buzz"
            testID="pairing-found-buzz"
            style={{ marginTop: theme.spacing.s }}
          >
            Make it buzz
          </Button>
        </>
      ) : null}
      {supportsWebBluetoothHandoff && discovered.length === 0 ? (
        <WebBluetoothHandoff />
      ) : null}
      <CancelLink onCancel={onCancel} />
    </View>
  );
}

function PairingView() {
  const theme = useTheme();
  // Audit P1-7.
  useAnnounceOnChange(A11Y_PAIRING);
  return (
    <View
      testID="pairing-pairing"
      accessibilityLiveRegion="polite"
      accessibilityLabel={A11Y_PAIRING}
    >
      <Headline>Talking to the watch</Headline>
      <Body muted>Hang on — almost there.</Body>
      <View style={{ alignItems: 'center', marginVertical: theme.spacing.xxl }}>
        <ActivityIndicator size="large" color={theme.colors.brand.primary} />
      </View>
    </View>
  );
}

function SuccessView({ onContinue }: { onContinue: () => void }) {
  const theme = useTheme();
  const pairedDevice = usePairing((s) => s.pairedDevice);
  // Audit P1-7.
  const a11yLabel = pairedDevice
    ? `Paired. The watch ending ${pairedDevice.macSuffix} is connected.`
    : 'Paired. The watch is connected.';
  useAnnounceOnChange(a11yLabel);
  return (
    <View
      testID="pairing-success"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={a11yLabel}
    >
      <View
        style={{
          alignItems: 'center',
          marginVertical: theme.spacing.xxl,
        }}
      >
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: theme.colors.brand.accent,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: theme.spacing.l,
          }}
        >
          <Text
            style={{
              color: theme.colors.text.primary,
              fontSize: 40,
              fontWeight: '700',
            }}
          >
            ✓
          </Text>
        </View>
      </View>
      <Headline>Paired</Headline>
      <Body muted>
        {pairedDevice
          ? `The watch ending ${pairedDevice.macSuffix} is connected.`
          : 'The watch is connected.'}
      </Body>
      <Button
        variant="primary"
        onPress={onContinue}
        accessibilityLabel="Continue"
        testID="pairing-success-continue"
        style={{ marginTop: theme.spacing.l }}
      >
        Continue
      </Button>
    </View>
  );
}

function FailureView({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  const error = usePairing((s) => s.error);
  const retry = usePairing((s) => s.retry);
  // Audit P1-7 — the failure phase had no live region on either platform,
  // so a screen-reader user got no signal that pairing had stopped.
  const a11yLabel = `We couldn't reach the watch. ${
    error?.friendly ?? 'Something got in the way. Try again?'
  }`;
  useAnnounceOnChange(a11yLabel);
  return (
    <View
      testID="pairing-failure"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={a11yLabel}
    >
      <Headline>We couldn't reach the watch</Headline>
      <Body muted>
        {error?.friendly ?? 'Something got in the way. Try again?'}
      </Body>
      <Button
        variant="primary"
        onPress={() => void retry()}
        accessibilityLabel="Try again"
        testID="pairing-failure-retry"
        style={{ marginTop: theme.spacing.l }}
      >
        Try again
      </Button>
      <CancelLink onCancel={onCancel} label="Not now" />
    </View>
  );
}

function PermissionDeniedView({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  return (
    <View testID="pairing-permission-denied">
      <Headline>Bluetooth permission is off</Headline>
      <Body muted>
        We need Bluetooth permission to talk to the watch. You can turn it
        on in Settings.
      </Body>
      <Button
        variant="primary"
        onPress={() => void Linking.openSettings()}
        accessibilityLabel="Open settings"
        testID="pairing-permission-settings"
        style={{ marginTop: theme.spacing.l }}
      >
        Open settings
      </Button>
      <CancelLink onCancel={onCancel} label="Not now" />
    </View>
  );
}

function BluetoothOffView({ onCancel }: { onCancel: () => void }) {
  const theme = useTheme();
  return (
    <View testID="pairing-bluetooth-off">
      <Headline>Bluetooth is off</Headline>
      <Body muted>
        Turn Bluetooth on so we can find the watch.
      </Body>
      <Button
        variant="primary"
        onPress={() => void Linking.openSettings()}
        accessibilityLabel="Open settings"
        testID="pairing-bluetooth-settings"
        style={{ marginTop: theme.spacing.l }}
      >
        Open settings
      </Button>
      <CancelLink onCancel={onCancel} label="Not now" />
    </View>
  );
}

function CancelLink({ onCancel, label = 'Cancel' }: { onCancel: () => void; label?: string }) {
  const theme = useTheme();
  const body = theme.type('bodyL');
  return (
    <Pressable
      onPress={onCancel}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="pairing-cancel-link"
      hitSlop={theme.spacing.m}
      style={{ alignSelf: 'center', marginTop: theme.spacing.xxl }}
    >
      <Text
        style={{
          color: theme.colors.brand.primary,
          fontSize: body.size,
          fontFamily: body.family,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Web Bluetooth handoff (Android-only fallback) ───────────────────
//
// When the caregiver's phone can't see the watch — usually because the
// watch is physically with the parent in a different city — we offer a
// QR code that opens https://pair.leiko.app/{url_token} on the parent's
// Android Chrome. The Next.js page (separate repo, out of Sprint 5
// scope) handles the actual Web Bluetooth pairing. Here we only render
// the QR + a brief explainer.
//
// The url_token comes from the family's open invitation of kind
// 'parent_pairing' (see migrations/0001_initial.sql). Sprint 5 displays
// a placeholder when the token isn't yet available — Sprint 6 wires the
// invitation creation. iOS users see the Universal Link affordance
// instead (per docs/06-ble-protocol.md §6).
function WebBluetoothHandoff() {
  const theme = useTheme();
  const familyId = useOnboarding((s) => s.familyId);
  const body = theme.type('bodyM');
  const url = familyId
    ? `https://pair.leiko.app/family-${familyId.slice(0, 8)}`
    : 'https://pair.leiko.app';
  return (
    <Card
      elevation="low"
      style={{ marginTop: theme.spacing.xl }}
      testID="pairing-web-handoff"
      accessibilityLabel="If the watch is with someone else, share this link"
    >
      <Text
        style={{
          color: theme.colors.text.primary,
          fontSize: theme.type('title').size,
          fontWeight: '600',
          fontFamily: theme.type('title').family,
          marginBottom: theme.spacing.s,
        }}
      >
        Pair from your parent's phone
      </Text>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: body.size,
          lineHeight: body.lineHeight,
          fontFamily: body.family,
        }}
      >
        Send them this link. They open it on their phone and follow the steps.
      </Text>
      <Text
        selectable
        testID="pairing-web-handoff-url"
        style={{
          color: theme.colors.brand.primary,
          fontSize: body.size,
          fontFamily: body.family,
          marginTop: theme.spacing.s,
        }}
      >
        {url}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Share link"
        testID="pairing-web-handoff-share"
        onPress={() => {
          void Share.share({
            message: `Hi — tap this link from your phone to set up the watch: ${url}`,
            url,
          });
        }}
        hitSlop={theme.spacing.m}
        style={{ marginTop: theme.spacing.s }}
      >
        <Text
          style={{
            color: theme.colors.brand.primary,
            fontSize: body.size,
            fontFamily: body.family,
          }}
        >
          Share link
        </Text>
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: theme.type('caption').size,
            fontFamily: theme.type('caption').family,
            marginTop: theme.spacing.s,
          }}
        >
          On iPhone, the link opens Leiko if installed, or the App Store.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
