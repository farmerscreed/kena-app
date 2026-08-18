// ReadingDetailScreen — Sprint 6.
//
// Per docs/04-screens/reading-detail.md, with caregiver vs self-buyer
// variants per D8a §7.
//
// Sprint 6 scope is intentionally trimmed:
//   - Hero numeric + tier chip + secondary stats + ghost anchors
//   - "Why this reading?" / "What does this mean?" buttons render but
//     do nothing (Sprint 13 wires the Inline Explainer)
//   - "Mark as not me" soft-hides via reading-store mutation (caregiver
//     mode only; D8a §7.2 removes it from self-buyer mode)
//   - Notes/comments thread is OUT of scope — Sprint 7/8 territory
//   - First-reading auto-expand explainer is OUT of scope — Sprint 13

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';
import { InlineExplainer } from '../../components/InlineExplainer';
import { ScreenAnomalyBanner } from '../../components/ScreenAnomalyBanner';
import { useTheme } from '../../theme';
import { useReadings } from '../../state/readings';
import { useAuth } from '../../state/auth';
import { useReadingParagraph } from '../../hooks/useReadingParagraph';
import { MAX_FONT_SCALE } from '../../theme/fontScaling';
import {
  tierChipText,
  tierPillVariant,
} from '../../utils/classification';

type Props = {
  navigation: {
    goBack: () => void;
    /** Optional. When supplied, the Inline Explainer's related-card and
     *  "Read more in Learn" CTAs route through it. Tests + Sprint-6
     *  callers that don't pass it still get the explainer locally. */
    navigate?: (screen: string, params?: unknown) => void;
  };
};

type ReadingDetailParams = { readingLocalId: string };

function formatTimestamp(measuredAtSec: number): string {
  const d = new Date(measuredAtSec * 1000);
  const diffMs = Date.now() - d.getTime();
  const hours = diffMs / 3_600_000;
  if (hours < 24) {
    return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return `${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function ReadingDetailScreen({ navigation }: Props) {
  const theme = useTheme();
  const route = useRoute<RouteProp<Record<string, ReadingDetailParams>, string>>();
  const localId = route.params?.readingLocalId;
  const reading = useReadings((s) => (localId ? s.byLocalId(localId) : null));
  const accountType = useAuth((s) => s.profile?.account_type);

  const headline = theme.type('headline');
  const numericXl = theme.type('numericXl');
  const numericM = theme.type('numericM');
  const bodyM = theme.type('bodyM');
  const caption = theme.type('caption');

  if (!reading) {
    return (
      <SafeAreaView
        style={[styles.root, { backgroundColor: theme.colors.surface.base }]}
        edges={['top', 'bottom']}
        testID="reading-detail-screen"
      >
        <View style={{ padding: theme.spacing.xxl }}>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyM.size,
              fontFamily: bodyM.family,
            }}
          >
            We can't find that reading. It may have been removed.
          </Text>
          <Button
            variant="ghost"
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
            testID="reading-detail-back-empty"
            style={{ marginTop: theme.spacing.l }}
          >
            Back
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const isSelf = accountType === 'self_buyer';
  const tier = reading.classification.tier;
  const [explainerOpen, setExplainerOpen] = useState(false);

  // Sprint 12.5 session 2 — Tier-A contextual paragraph. Renders
  // synchronously above the chart as the screen's editorial layer.
  // Tier-B novel-pattern path lands later via an Edge Function.
  const paragraph = useReadingParagraph(reading);

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.surface.base }]}
      edges={['top', 'bottom']}
      testID="reading-detail-screen"
    >
      {/* Sprint 18 bench bug — sticky top bar with a visually obvious
          Back affordance. The old text-only "Back" link sat INSIDE the
          ScrollView so it scrolled away when the user scrolled down to
          read Pulse / actions, leaving them with no apparent exit.
          Chevron + bold + amber colour + outside the scroll container
          fixes all three. */}
      <View
        style={{
          paddingHorizontal: theme.spacing.xxl,
          paddingTop: theme.spacing.m,
          paddingBottom: theme.spacing.s,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={theme.spacing.m}
          testID="reading-detail-back"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: theme.spacing.m,
            paddingVertical: theme.spacing.s,
            borderRadius: theme.radii.m,
            backgroundColor: theme.colors.surface.warmSubtle,
            borderWidth: 0.5,
            borderColor: theme.colors.border.rim,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              color: theme.colors.brand.primary,
              fontSize: bodyM.size + 4,
              lineHeight: bodyM.lineHeight,
              fontFamily: bodyM.family,
              fontWeight: '600',
              marginRight: theme.spacing.xs,
            }}
          >
            {'‹'}
          </Text>
          <Text
            style={{
              color: theme.colors.brand.primary,
              fontSize: bodyM.size,
              fontFamily: bodyM.family,
              fontWeight: '600',
            }}
          >
            Back
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingHorizontal: theme.spacing.xxl,
            paddingTop: theme.spacing.l,
            paddingBottom: theme.spacing.xxxl,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.text.primary,
            fontSize: headline.size,
            lineHeight: headline.lineHeight,
            fontWeight: headline.weight as '600',
            fontFamily: headline.family,
            marginBottom: theme.spacing.xs,
          }}
        >
          {isSelf ? 'Your reading' : 'Reading'}
        </Text>
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: caption.size,
            fontFamily: caption.family,
            marginBottom: theme.spacing.xxl,
          }}
        >
          {formatTimestamp(reading.measuredAtSec)}
          {reading.serverId === null ? ' · Pending sync' : ''}
        </Text>

        {/* Sprint 15 — anomaly banner scoped to this reading. Renders
            nothing when there's no event for this serverId. */}
        <View style={{ marginBottom: theme.spacing.l }}>
          <ScreenAnomalyBanner readingServerId={reading.serverId ?? undefined} />
        </View>

        <View
          style={{
            alignItems: 'center',
            marginBottom: theme.spacing.l,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text
              accessibilityLabel={`${reading.systolic} over ${reading.diastolic} mmHg, pulse ${reading.pulse ?? 'unknown'}`}
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
        </View>

        <View style={{ alignItems: 'center', marginBottom: theme.spacing.s }}>
          <Pill variant={tierPillVariant(tier)}>{tierChipText(tier)}</Pill>
        </View>

        {paragraph ? (
          <View
            testID="reading-detail-paragraph"
            style={{
              marginTop: theme.spacing.l,
              marginBottom: theme.spacing.l,
              paddingHorizontal: theme.spacing.s,
            }}
          >
            <Text
              style={{
                color: theme.colors.text.primary,
                fontSize: bodyM.size,
                lineHeight: bodyM.lineHeight,
                fontFamily: bodyM.family,
                textAlign: 'center',
              }}
            >
              {paragraph.text}
            </Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What does this mean? Opens explanation sheet."
          accessibilityHint="Opens explanation sheet"
          testID="reading-detail-anchor-meaning"
          onPress={() => setExplainerOpen(true)}
          style={{
            alignSelf: 'center',
            marginTop: theme.spacing.s,
            marginBottom: theme.spacing.xxl,
          }}
        >
          <Text
            style={{
              color: theme.colors.brand.primarySoft,
              fontSize: bodyM.size,
              fontFamily: bodyM.family,
            }}
          >
            What does this mean?
          </Text>
        </Pressable>

        {/* Secondary stats */}
        <View accessible={true}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-around',
            marginBottom: theme.spacing.xxl,
          }}
          accessibilityLabel={`Pulse ${reading.pulse ?? 'unknown'}`}
        >
          <SecondaryStat
            label="Pulse"
            value={reading.pulse != null ? String(reading.pulse) : '—'}
            unit="bpm"
            numericStyle={numericM}
            captionStyle={caption}
          />
        </View>

        {/* Sprint 18 — removed three ghost buttons that shipped to
            users with onPress={() => undefined} ("Why this reading?",
            "Mark as not me", "Add a note" / "Note for my doctor").
            Tapping them did literally nothing — confusing UX. The
            working "What does this mean?" pressable above already
            opens the InlineExplainer; the other three were Sprint
            7/13 placeholders that never got wired. Bring them back
            when their real handlers land (notes UI; soft-hide for
            "not me"; richer explainer for "why"). */}

        {/* Sprint 18 bench bug — an explicit Done CTA at the bottom of
            the scroll content. Calls goBack so it works in both nav
            contexts: post-take-reading (where TakeReading replaced
            itself, so Back → Home) AND from-a-list (where Back returns
            to the list). The top Back chip is the same target; this is
            here for the user who scrolled all the way down and wants
            one obvious "I'm done" tap. */}
        <Button
          variant="primary"
          onPress={() => navigation.goBack()}
          accessibilityLabel="Done"
          testID="reading-detail-done"
          style={{ marginTop: theme.spacing.xxl }}
        >
          Done
        </Button>
      </ScrollView>

      <InlineExplainer
        visible={explainerOpen}
        onDismiss={() => setExplainerOpen(false)}
        context={{
          type: 'bp',
          reading: { systolic: reading.systolic, diastolic: reading.diastolic },
        }}
        onArticleOpen={
          navigation.navigate
            ? (id) => navigation.navigate?.('Article', { articleId: id })
            : undefined
        }
        onLearnOpen={
          navigation.navigate ? () => navigation.navigate?.('Learn') : undefined
        }
      />
    </SafeAreaView>
  );
}

function SecondaryStat({
  label,
  value,
  unit,
  numericStyle,
  captionStyle,
}: {
  label: string;
  value: string;
  unit: string;
  numericStyle: { size: number; lineHeight: number; weight: string; family: string };
  captionStyle: { size: number; family: string };
}) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: captionStyle.size,
          fontFamily: captionStyle.family,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: numericStyle.size,
            lineHeight: numericStyle.lineHeight,
            fontWeight: numericStyle.weight as '500',
            fontFamily: numericStyle.family,
          }}
        >
          {value}
        </Text>
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: captionStyle.size,
            fontFamily: captionStyle.family,
            marginLeft: theme.spacing.xs,
          }}
        >
          {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
});
