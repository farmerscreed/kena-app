// StorySection — the Story Trends assembly (founder-commissioned,
// 2026-08-19). The top of the Trends page becomes the person's story:
//
//   [ the Letter ]        — the AI voice (weekly/monthly Tier-C rows)
//   [ the Band River ]    — the usual band over time; movement IS the
//                           answer to "is it working?"
//   [ Chapters ]          — real events + detected shifts, before/since
//
// Every sentence is observational; the correlation cards below the
// section (existing Trends content) carry the "what moves together"
// evidence. The doctor link is the exit for interpretation.

import { useQuery } from '@tanstack/react-query';
import { Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE, MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import { supabase } from '../services/supabase';
import { fetchBandRiver } from '../services/story/bandRiver';
import {
  buildStoryChapters,
  movementRegularityOnset,
  type ChapterAnchorEvent,
} from '../services/story/chapters';
import { BandRiver } from './BandRiver';
import { storyCopy } from '../services/voice/storyCopy';

export interface StorySectionProps {
  familyId: string | null;
  /** The signed-in user — the letter cache is self-scoped by RLS. */
  userId: string | null;
  testID?: string;
}

interface LetterRow {
  body: string;
  surface: string;
  generated_at: string;
}

export function StorySection({ familyId, userId, testID = 'story-section' }: StorySectionProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const story = useQuery({
    queryKey: ['story-river', familyId],
    enabled: familyId != null,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const river = await fetchBandRiver(supabase, familyId as string);
      const meds = await supabase
        .from('medications')
        .select('label, created_at')
        .eq('family_id', familyId as string)
        .eq('active', true);
      const events: ChapterAnchorEvent[] = [];
      for (const m of (meds.data ?? []) as Array<{ label: string; created_at: string }>) {
        events.push({ kind: 'medication', date: m.created_at.slice(0, 10), label: m.label });
      }
      const onset = movementRegularityOnset(river.readings);
      if (onset) events.push({ kind: 'movement', date: onset });
      return {
        river,
        chapters: buildStoryChapters(river.anchors, river.changePoints, events),
      };
    },
  });

  const letter = useQuery({
    queryKey: ['story-letter', userId],
    enabled: userId != null,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const res = await supabase
        .from('ai_narration_cache')
        .select('body, surface, generated_at')
        .eq('user_id', userId as string)
        .in('surface', ['weekly_summary', 'monthly_baseline'])
        .eq('flagged', false)
        .order('generated_at', { ascending: false })
        .limit(1);
      return ((res.data ?? []) as LetterRow[])[0] ?? null;
    },
  });

  const title = theme.type('title');
  const caption = theme.type('caption');
  const anchors = story.data?.river.anchors ?? [];
  const chapters = story.data?.chapters ?? [];

  if (!familyId) return null;
  const thin = story.isSuccess && anchors.length < 2;

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8 }} testID={testID}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[title, { color: theme.colors.text.primary, marginBottom: 8 }]}
      >
        {storyCopy.pageTitle}
      </Text>

      {letter.data ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          accessibilityLabel={`${storyCopy.letterEyebrow}. ${letter.data.body}`}
          style={{
            fontFamily: theme.fontFamilies.voice,
            fontSize: 18,
            lineHeight: 27,
            color: theme.colors.text.secondary,
            marginBottom: 16,
          }}
          testID={`${testID}-letter`}
        >
          {letter.data.body}
        </Text>
      ) : null}

      {thin ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[caption, { color: theme.colors.text.tertiary, marginBottom: 8 }]}
          testID={`${testID}-building`}
        >
          {storyCopy.chapters.building}
        </Text>
      ) : (
        <BandRiver
          anchors={anchors}
          changePoints={story.data?.river.changePoints ?? []}
          width={Math.min(width - 40, 520)}
          testID={`${testID}-river`}
        />
      )}

      {thin ? null : chapters.length > 0 ? (
        <View style={{ marginTop: 16 }} testID={`${testID}-chapters`}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
            style={{
              fontFamily: theme.fontFamilies.eyebrow,
              fontSize: 11,
              lineHeight: 14,
              letterSpacing: 0.88,
              textTransform: 'uppercase',
              color: theme.colors.text.tertiary,
              marginBottom: 6,
            }}
          >
            {storyCopy.chapters.eyebrow}
          </Text>
          {chapters.map((ch) => (
            <View
              key={ch.id}
              accessible={true}
              accessibilityRole="text"
              accessibilityLabel={[ch.sentence, ...ch.alongside].join(' ')}
              style={{
                paddingVertical: 10,
                borderLeftWidth: 2,
                borderLeftColor:
                  ch.direction === 'down'
                    ? theme.colors.status.clear
                    : ch.direction === 'up'
                      ? theme.colors.status.attention
                      : theme.colors.status.learning,
                paddingLeft: 12,
                marginBottom: 8,
              }}
              testID={`${testID}-chapter-${ch.id}`}
            >
              {ch.sentence ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[theme.type('bodyM'), { color: theme.colors.text.primary }]}
                >
                  {ch.sentence}
                </Text>
              ) : null}
              {ch.alongside.length > 0 ? (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[caption, { color: theme.colors.text.tertiary, marginTop: 2 }]}
                >
                  {`${storyCopy.chapters.alongside} ${ch.alongside.join(' ')}`}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[caption, { color: theme.colors.text.tertiary, marginTop: 12 }]}
          testID={`${testID}-steady`}
        >
          {storyCopy.chapters.noChapters}
        </Text>
      )}
    </View>
  );
}
