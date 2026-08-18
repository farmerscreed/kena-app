// ReadingCard — Sprint 6.
//
// Per docs/03-components/reading-card.md. Used by Sprint 6 (home
// placeholders), Sprint 7 (caregiver home), Sprint 8 (self-buyer home).
//
// ownerVariant prop:
//   'parent' (caregiver track, default)  → header row with parent
//                                          name + relationship + avatar
//   'self'   (self-buyer track)          → header row removed entirely
//
// Visual rules (CLAUDE.md anti-patterns):
//   - No shadow on cream surface
//   - Crimson stripe ONLY for confirmed-urgent state
//   - No count badges, no pulse animation on anomaly
//   - Tap target = entire card; renders as accessibilityRole="button"

import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { StatusChip } from './StatusChip';
import { useTheme } from '../theme';
import { canonicalTierFor, type Tier } from '../utils/classification';
import type { LocalReading } from '../state/readings';

export type ReadingCardOwnerVariant = 'parent' | 'self';

export interface ReadingCardProps {
  reading: LocalReading;
  ownerVariant?: ReadingCardOwnerVariant;
  /** Caregiver-mode header. Required when ownerVariant='parent'. */
  parentName?: string;
  parentRelationship?: string;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

function formatRelative(measuredAtSec: number): string {
  const diffMs = Date.now() - measuredAtSec * 1000;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const d = new Date(measuredAtSec * 1000);
    return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return new Date(measuredAtSec * 1000).toLocaleDateString();
}

function tierAccessibilitySuffix(tier: Tier): string {
  switch (tier) {
    case 'in_range':
      return '';
    case 'learning':
      return ' — still learning their usual';
    case 'worth_a_look':
      return ' — worth a chat';
    case 'talk_to_doctor':
      return ' — talk to your doctor';
  }
}

export function ReadingCard({
  reading,
  ownerVariant = 'parent',
  parentName,
  parentRelationship,
  onPress,
  testID,
  style,
}: ReadingCardProps) {
  const theme = useTheme();
  // D13 PR-4 — verdict-aware tier: a below-sufficiency reading shows
  // the grey Learning chip, never a coloured claim.
  const tier = canonicalTierFor(reading.classification);
  const isUrgent = tier === 'talk_to_doctor';
  const showTierBadge = tier !== 'in_range';
  const isOffline = reading.serverId === null;

  const title = theme.type('title');
  const caption = theme.type('caption');
  const numericL = theme.type('numericL');
  const bodyM = theme.type('bodyM');

  const valueText = `${reading.systolic}/${reading.diastolic}`;
  const a11yLabel =
    ownerVariant === 'parent'
      ? `${parentName ?? 'Their'} most recent reading: ${reading.systolic} over ${reading.diastolic} mmHg, pulse ${reading.pulse ?? 'unknown'}, ${formatRelative(reading.measuredAtSec)}.${tierAccessibilitySuffix(tier)}`
      : `Your most recent reading: ${reading.systolic} over ${reading.diastolic} mmHg, pulse ${reading.pulse ?? 'unknown'}, ${formatRelative(reading.measuredAtSec)}.${tierAccessibilitySuffix(tier)}`;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        {
          backgroundColor: theme.colors.surface.subtle,
          borderRadius: theme.radii.m,
          padding: theme.spacing.l,
          opacity: pressed && onPress ? 0.94 : 1,
          // Confirmed-urgent left-edge stripe — the ONLY place crimson
          // appears on this card. Not animated (calm-before-clever).
          borderLeftWidth: isUrgent ? 4 : 0,
          borderLeftColor: isUrgent ? theme.colors.state.urgent : 'transparent',
        },
        style,
      ]}
    >
      {ownerVariant === 'parent' && parentName ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: theme.spacing.s,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: theme.colors.text.primary,
                fontSize: title.size,
                lineHeight: title.lineHeight,
                fontWeight: title.weight as '600',
                fontFamily: title.family,
              }}
            >
              {parentName}
            </Text>
            {parentRelationship ? (
              <Text
                style={{
                  color: theme.colors.text.secondary,
                  fontSize: caption.size,
                  fontFamily: caption.family,
                }}
              >
                {parentRelationship}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          marginBottom: theme.spacing.xs,
        }}
      >
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{
            color: theme.colors.text.primary,
            fontSize: numericL.size,
            lineHeight: numericL.lineHeight,
            fontWeight: numericL.weight as '500',
            fontFamily: numericL.family,
          }}
        >
          {valueText}
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

      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: caption.size,
          fontFamily: caption.family,
          marginBottom: showTierBadge ? theme.spacing.s : 0,
        }}
      >
        {formatRelative(reading.measuredAtSec)}
        {isOffline ? ' · Pending sync' : ''}
      </Text>

      {showTierBadge ? (
        <StatusChip tier={tier} size="s" nestedInLabelledCard />
      ) : null}
    </Pressable>
  );
}
