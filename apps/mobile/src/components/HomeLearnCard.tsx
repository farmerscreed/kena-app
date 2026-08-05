// HomeLearnCard — Sprint 14 task 4.
//
// Small "Worth a read" card slotted on the home screens between the
// Daily Pulse hero and the next section. Surfaces one Learn article
// at a time, picked by services/learn/seedSelection.ts.
//
// Sourced from:
//   docs/08-learn-module.md §4.3 (Surface C — Home-seeded card)
//   plans/sprint-14-learn-c.md (acceptance criteria — dismiss/read flow)
//   docs/_reference/D12-visual-system-v2.md §6 (elevation tokens)
//
// Behaviour:
//   - Tap the card body → onArticleOpen(articleId), parent owns
//     navigation + marks read in the seed store.
//   - Tap the small × → onDismiss(articleId), parent updates the seed
//     store; the card hides for 30 days.
//   - Renders nothing when `article` is null (caller filters before
//     mounting).

import { Platform, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';
import type { CompiledArticle } from '../services/learn/ast';
import type { BlockNode, InlineNode } from '../services/learn/ast';
import { MAX_FONT_SCALE_PROSE } from '../theme/fontScaling';

export interface HomeLearnCardProps {
  article: CompiledArticle;
  onArticleOpen: (articleId: string) => void;
  onDismiss: (articleId: string) => void;
  testID?: string;
}

export function HomeLearnCard({
  article,
  onArticleOpen,
  onDismiss,
  testID,
}: HomeLearnCardProps) {
  const theme = useTheme();
  const eyebrowStyle = theme.type('labelUppercase');
  const titleStyle = theme.type('title');
  const bodyStyle = theme.type('bodyM');

  const excerpt = extractExcerpt(article.blocks, 100);
  const cardElevation =
    Platform.OS === 'ios'
      ? theme.elevation.medium.ios
      : theme.elevation.medium.android;

  return (
    <View
      style={{
        marginHorizontal: theme.spacing.xl,
        marginTop: theme.spacing.l,
        marginBottom: theme.spacing.l,
      }}
      testID={testID ?? 'home-learn-card'}
    >
      <Pressable
        onPress={() => onArticleOpen(article.frontmatter.id)}
        accessibilityRole="link"
        accessibilityLabel={`Worth a read: ${article.frontmatter.title}`}
        accessibilityHint="Opens the article"
        testID="home-learn-card-body"
        style={({ pressed }) => ({
          backgroundColor: theme.colors.surface.warmElevated,
          borderTopColor: theme.colors.border.rim,
          borderTopWidth: 1,
          borderRadius: theme.radii.l,
          padding: theme.spacing.l,
          opacity: pressed ? 0.92 : 1,
          ...cardElevation,
        })}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: theme.spacing.s,
          }}
        >
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
            style={{
              color: theme.colors.text.tertiary,
              fontSize: eyebrowStyle.size,
              lineHeight: eyebrowStyle.lineHeight,
              fontFamily: eyebrowStyle.family,
              fontWeight: eyebrowStyle.weight as '500',
              letterSpacing: eyebrowStyle.letterSpacing,
              textTransform: 'uppercase',
            }}
          >
            Worth a read
          </Text>
          <Pressable
            onPress={() => onDismiss(article.frontmatter.id)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this card"
            accessibilityHint="Hides this card for 30 days"
            hitSlop={theme.spacing.m}
            testID="home-learn-card-dismiss"
          >
            <Text
              style={{
                color: theme.colors.text.tertiary,
                fontSize: 18,
                lineHeight: 18,
                fontFamily: bodyStyle.family,
              }}
            >
              ×
            </Text>
          </Pressable>
        </View>

        <Text
          style={{
            color: theme.colors.text.primary,
            fontSize: titleStyle.size,
            lineHeight: titleStyle.lineHeight,
            fontFamily: titleStyle.family,
            fontWeight: titleStyle.weight as '600',
            marginBottom: theme.spacing.xs,
          }}
        >
          {article.frontmatter.title}
        </Text>

        {excerpt ? (
          <Text
            numberOfLines={2}
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              lineHeight: bodyStyle.lineHeight,
              fontFamily: bodyStyle.family,
            }}
          >
            {excerpt}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

// -----------------------------------------------------------------
// Excerpt extraction — pull plain text from the first paragraph
// block, truncated to ~100 chars on a word boundary.
// -----------------------------------------------------------------

export function extractExcerpt(blocks: BlockNode[], maxLen: number): string {
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      const text = inlineToText(block.children).trim();
      if (text.length === 0) continue;
      return truncate(text, maxLen);
    }
  }
  return '';
}

function inlineToText(nodes: InlineNode[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out += n.value;
        break;
      case 'strong':
      case 'em':
      case 'definition':
        out += inlineToText(n.children);
        break;
      case 'code':
        out += n.value;
        break;
      case 'reading':
        out += `${n.systolic}/${n.diastolic} mmHg`;
        break;
      case 'cardlink':
        // Card links shouldn't appear in the excerpt — skip silently.
        break;
    }
  }
  return out;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  // Prefer a word-boundary cut.
  const window = text.slice(0, maxLen + 1);
  const lastSpace = window.lastIndexOf(' ');
  const cutAt = lastSpace > maxLen * 0.6 ? lastSpace : maxLen;
  return `${text.slice(0, cutAt).trimEnd()}…`;
}

