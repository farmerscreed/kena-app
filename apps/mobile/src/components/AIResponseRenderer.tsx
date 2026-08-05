// AIResponseRenderer — Sprint 11 task 8.
//
// Tier-A response renderer. Takes an IntentMatch and renders the
// appropriate UI for the response mode (ANSWER / EDUCATE / DEFER)
// plus the Tier-B placeholder fallthrough.
//
// Navigation-agnostic: the caller passes onArticleOpen so the same
// component works from caregiver / self-buyer stacks. EDUCATE
// surfaces a tappable card-link that routes to ArticleScreen.

import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { ARTICLES_BY_ID } from '../learn/articleIndex.gen';
import { DEFER_TEMPLATES } from '../services/ai/deferTemplates';
import { TIER_B_PLACEHOLDER_TEXT } from '../services/ai/tierBPlaceholder';
import type { IntentMatch } from '../services/ai/types';
import { MAX_FONT_SCALE_PROSE } from '../theme/fontScaling';

export interface AIResponseRendererProps {
  result: IntentMatch;
  onArticleOpen?: (articleId: string) => void;
  testID?: string;
}

export function AIResponseRenderer({
  result,
  onArticleOpen,
  testID,
}: AIResponseRendererProps) {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyL');
  const labelStyle = theme.type('labelUppercase');

  return (
    <View testID={testID ?? 'ai-response'}>
      {result.responseMode === 'TIER_B_PLACEHOLDER' && (
        <Text
          style={{
            color: theme.colors.text.secondary,
            fontSize: bodyStyle.size,
            lineHeight: bodyStyle.lineHeight,
            fontFamily: bodyStyle.family,
          }}
          testID="ai-response-tier-b-placeholder"
        >
          {TIER_B_PLACEHOLDER_TEXT}
        </Text>
      )}

      {result.responseMode === 'ANSWER' && result.intent?.answerTemplate && (
        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: bodyStyle.size,
            lineHeight: bodyStyle.lineHeight,
            fontFamily: bodyStyle.family,
          }}
          testID="ai-response-answer"
        >
          {result.intent.answerTemplate}
        </Text>
      )}

      {result.responseMode === 'EDUCATE' && result.intent?.cardId && (
        <View testID="ai-response-educate">
          <Text
            style={{
              color: theme.colors.text.primary,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
              fontFamily: bodyStyle.family,
              marginBottom: theme.spacing.l,
            }}
          >
            {result.intent.educateLeadIn ??
              "There's a card on this in Learn — tap below to read it."}
          </Text>
          <CardLinkRow
            cardId={result.intent.cardId}
            onPress={() =>
              onArticleOpen?.(result.intent!.cardId as string)
            }
            labelStyle={labelStyle}
            bodyStyle={bodyStyle}
          />
        </View>
      )}

      {result.responseMode === 'DEFER' && result.intent?.deferTrigger && (
        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: bodyStyle.size,
            lineHeight: bodyStyle.lineHeight,
            fontFamily: bodyStyle.family,
          }}
          testID={`ai-response-defer-${result.intent.deferTrigger}`}
        >
          {DEFER_TEMPLATES[result.intent.deferTrigger]}
        </Text>
      )}
    </View>
  );
}

// -----------------------------------------------------------------
// Internal — the inline card link.
// -----------------------------------------------------------------

interface CardLinkRowProps {
  cardId: string;
  onPress: () => void;
  labelStyle: ReturnType<ReturnType<typeof useTheme>['type']>;
  bodyStyle: ReturnType<ReturnType<typeof useTheme>['type']>;
}

function CardLinkRow({ cardId, onPress, labelStyle, bodyStyle }: CardLinkRowProps) {
  const theme = useTheme();
  const article = ARTICLES_BY_ID[cardId];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Open ${article?.frontmatter.title ?? cardId}`}
      testID={`ai-response-card-link-${cardId}`}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface.warmElevated,
        borderTopColor: theme.colors.border.rim,
        borderTopWidth: 1,
        borderRadius: theme.radii.l,
        paddingVertical: theme.spacing.m,
        paddingHorizontal: theme.spacing.l,
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
        style={{
          color: theme.colors.text.tertiary,
          fontSize: labelStyle.size,
          lineHeight: labelStyle.lineHeight,
          fontFamily: labelStyle.family,
          fontWeight: labelStyle.weight as '500',
          letterSpacing: labelStyle.letterSpacing,
          textTransform: 'uppercase',
          marginBottom: theme.spacing.xs,
        }}
      >
        Learn
      </Text>
      <Text
        style={{
          color: theme.colors.text.primary,
          fontSize: bodyStyle.size,
          lineHeight: bodyStyle.lineHeight,
          fontFamily: bodyStyle.family,
          fontWeight: '500',
        }}
      >
        {article?.frontmatter.title ?? cardId}
      </Text>
    </Pressable>
  );
}
