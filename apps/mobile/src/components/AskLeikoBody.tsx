// AskLeikoBody — Sprint 12 follow-up.
//
// The reusable input + response surface for "Ask Leiko". Lifted out
// of AskLeikoScreen.tsx so both the full-screen route and the new
// bottom-sheet popup (AskLeikoSheet) can share the question-input,
// Tier-A intent classification, Tier-B fall-through state machine,
// and rendered result without duplicating the logic.
//
// Single-shot per submit — the user types a question, taps Send, and
// sees a result. Editing the input + tapping Send again replaces the
// result. Multi-turn chat is intentionally NOT here (Sprint 12+).
//
// Voice rules apply to every string emitted from here. The Tier-B
// fall-through copy is voice-clean per D11 §3 / D14 §14.2.

import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../theme';
import { AIResponseRenderer } from './AIResponseRenderer';
import { classifyIntent } from '../services/ai/intentRouter';
import { askTierB, type TierBDeferTrigger } from '../services/ai/tierB';
import { DEFER_TEMPLATES } from '../services/ai/deferTemplates';
import { mapAskLeikoTierBResult } from '../services/ai/fallThrough';
import type { IntentMatch } from '../services/ai/types';
import { MAX_FONT_SCALE_PROSE } from '../theme/fontScaling';

export const ASK_LEIKO_COPY = {
  helper: 'A short, plain-language question works best.',
  placeholder: 'What is blood pressure?',
  send: 'Send',
  loading: 'Thinking…',
  // Verbatim from D14 §14.2.
  quotaExceeded:
    "You've used your AI questions for this month. They reset on the 1st.",
  // Structural-error copy — the user can fix these. Soft Tier-B errors
  // (network, client_timeout, unhandled codes) are silenced by the
  // Sprint 16 cascade in services/ai/fallThrough.ts and rendered as a
  // calm deterministic body (DETERMINISTIC_COPY.ask_leiko).
  errorNoFamily: 'Finish setting up Leiko first to ask questions.',
  errorNoSession: 'Sign in again to ask Leiko.',
  errorQuestionTooLong: 'That question is a bit long — try shortening it.',
  youAsked: 'You asked',
} as const;

type TierBStructuralErrorKind =
  | 'no_family'
  | 'no_session'
  | 'question_too_long';

type TierBState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; body: string; degraded: boolean }
  | { kind: 'defer'; trigger: TierBDeferTrigger }
  | { kind: 'quota_exceeded' }
  | { kind: 'error'; reason: TierBStructuralErrorKind };

// Map a server error code to the user-facing structural kind. Only
// structural errors (the user can fix them) reach this function —
// soft errors are already silenced by the fall-through cascade and
// rendered as `kind: 'ok'` with deterministic copy. Defaults to
// `no_session` because the only way for an unknown structural code
// to slip through is if the server adds one we don't know about,
// and "sign in again" is the safest blanket suggestion.
function mapStructuralError(error: string): TierBStructuralErrorKind {
  switch (error) {
    case 'no_family':
      return 'no_family';
    case 'no_session':
    case 'unauthorized':
      return 'no_session';
    case 'question_too_long':
      return 'question_too_long';
    default:
      return 'no_session';
  }
}

function copyForStructuralError(kind: TierBStructuralErrorKind): string {
  switch (kind) {
    case 'no_family':
      return ASK_LEIKO_COPY.errorNoFamily;
    case 'no_session':
      return ASK_LEIKO_COPY.errorNoSession;
    case 'question_too_long':
      return ASK_LEIKO_COPY.errorQuestionTooLong;
  }
}

export interface AskLeikoBodyProps {
  /** Called when an EDUCATE response surface taps a Learn card link. */
  onArticleOpen: (articleId: string) => void;
  testID?: string;
}

export function AskLeikoBody({ onArticleOpen, testID }: AskLeikoBodyProps) {
  const theme = useTheme();
  const bodyStyle = theme.type('bodyL');
  const captionStyle = theme.type('caption');

  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState<{
    text: string;
    result: IntentMatch;
  } | null>(null);
  const [tierBState, setTierBState] = useState<TierBState>({ kind: 'idle' });

  const onSubmit = () => {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    const result = classifyIntent(trimmed);
    setSubmitted({ text: trimmed, result });
    setQuestion('');

    if (result.responseMode === 'TIER_B_PLACEHOLDER') {
      setTierBState({ kind: 'loading' });
      askTierB({ question: trimmed })
        .then((r) => {
          const outcome = mapAskLeikoTierBResult(r);
          if (outcome.source === 'deterministic') {
            // Soft Tier-B failure — silent fall-through to deterministic
            // copy (Sprint 16 acceptance: never show an AI error).
            setTierBState({ kind: 'ok', body: outcome.body, degraded: true });
            return;
          }
          switch (outcome.status) {
            case 'ok':
              setTierBState({ kind: 'ok', body: outcome.body, degraded: false });
              break;
            case 'defer':
              setTierBState({
                kind: 'defer',
                trigger: outcome.trigger as TierBDeferTrigger,
              });
              break;
            case 'quota_exceeded':
              setTierBState({ kind: 'quota_exceeded' });
              break;
            case 'structural_error':
              setTierBState({
                kind: 'error',
                reason: mapStructuralError(outcome.reason),
              });
              break;
          }
        })
        .catch(() => {
          // Sprint 16.5i — defence-in-depth. `askTierB` already returns
          // a discriminated union and never throws by contract, but a
          // runtime error inside `.then()` body could escape as an
          // unhandled rejection and freeze the loading state forever.
          // Treat it as a soft Tier-B failure → silent deterministic
          // fall-through (Sprint 16 cascade: never show an AI error).
          setTierBState({
            kind: 'ok',
            body: ASK_LEIKO_COPY.errorNoSession,
            degraded: true,
          });
        });
    } else {
      setTierBState({ kind: 'idle' });
    }
  };

  return (
    <View testID={testID ?? 'ask-leiko-body'}>
      <Text
        style={{
          color: theme.colors.text.secondary,
          fontSize: bodyStyle.size,
          fontFamily: bodyStyle.family,
          lineHeight: bodyStyle.lineHeight,
          marginBottom: theme.spacing.l,
        }}
      >
        {ASK_LEIKO_COPY.helper}
      </Text>

      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder={ASK_LEIKO_COPY.placeholder}
        placeholderTextColor={theme.colors.text.tertiary}
        multiline
        accessibilityLabel="Type your question"
        testID="ask-leiko-input"
        style={{
          minHeight: 64,
          backgroundColor: theme.colors.surface.warmElevated,
          borderTopColor: theme.colors.border.rim,
          borderTopWidth: 1,
          borderRadius: theme.radii.l,
          padding: theme.spacing.l,
          color: theme.colors.text.primary,
          fontSize: bodyStyle.size,
          fontFamily: bodyStyle.family,
          lineHeight: bodyStyle.lineHeight,
          marginBottom: theme.spacing.l,
        }}
      />

      <Pressable
        onPress={onSubmit}
        disabled={question.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel="Send question"
        testID="ask-leiko-send"
        style={({ pressed }) => ({
          backgroundColor:
            question.trim().length === 0
              ? theme.colors.surface.warmSubtle
              : theme.colors.brand.primary,
          borderRadius: theme.radii.l,
          paddingVertical: theme.spacing.m,
          alignItems: 'center',
          opacity: pressed ? 0.92 : 1,
          marginBottom: theme.spacing.xl,
        })}
      >
        <Text
          style={{
            color:
              question.trim().length === 0
                ? theme.colors.text.tertiary
                : theme.colors.text.onBrand,
            fontSize: bodyStyle.size,
            fontFamily: bodyStyle.family,
            fontWeight: '500',
          }}
        >
          {ASK_LEIKO_COPY.send}
        </Text>
      </Pressable>

      {submitted ? (
        <View testID="ask-leiko-result">
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE_PROSE}
            style={{
              color: theme.colors.text.tertiary,
              fontSize: captionStyle.size,
              fontFamily: captionStyle.family,
              marginBottom: theme.spacing.s,
            }}
          >
            {ASK_LEIKO_COPY.youAsked}
          </Text>
          <Text
            style={{
              color: theme.colors.text.secondary,
              fontSize: bodyStyle.size,
              fontFamily: bodyStyle.family,
              fontStyle: 'italic',
              marginBottom: theme.spacing.xl,
            }}
          >
            {submitted.text}
          </Text>

          {tierBState.kind === 'idle' && (
            <AIResponseRenderer
              result={submitted.result}
              onArticleOpen={onArticleOpen}
            />
          )}
          {tierBState.kind === 'loading' && (
            <View
              testID="ask-leiko-tier-b-loading"
              style={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <ActivityIndicator
                size="small"
                color={theme.colors.text.secondary}
                style={{ marginRight: theme.spacing.s }}
              />
              <Text
                style={{
                  color: theme.colors.text.secondary,
                  fontSize: bodyStyle.size,
                  lineHeight: bodyStyle.lineHeight,
                  fontFamily: bodyStyle.family,
                }}
              >
                {ASK_LEIKO_COPY.loading}
              </Text>
            </View>
          )}
          {tierBState.kind === 'ok' && (
            <Text
              testID={
                tierBState.degraded
                  ? 'ask-leiko-tier-b-degraded'
                  : 'ask-leiko-tier-b-body'
              }
              style={{
                color: theme.colors.text.primary,
                fontSize: bodyStyle.size,
                lineHeight: bodyStyle.lineHeight,
                fontFamily: bodyStyle.family,
              }}
            >
              {tierBState.body}
            </Text>
          )}
          {tierBState.kind === 'defer' && (
            <Text
              testID={`ask-leiko-tier-b-defer-${tierBState.trigger}`}
              style={{
                color: theme.colors.text.primary,
                fontSize: bodyStyle.size,
                lineHeight: bodyStyle.lineHeight,
                fontFamily: bodyStyle.family,
              }}
            >
              {DEFER_TEMPLATES[tierBState.trigger]}
            </Text>
          )}
          {tierBState.kind === 'quota_exceeded' && (
            <Text
              testID="ask-leiko-tier-b-quota"
              style={{
                color: theme.colors.text.primary,
                fontSize: bodyStyle.size,
                lineHeight: bodyStyle.lineHeight,
                fontFamily: bodyStyle.family,
              }}
            >
              {ASK_LEIKO_COPY.quotaExceeded}
            </Text>
          )}
          {tierBState.kind === 'error' && (
            <Text
              testID={`ask-leiko-tier-b-error-${tierBState.reason}`}
              style={{
                color: theme.colors.text.secondary,
                fontSize: bodyStyle.size,
                lineHeight: bodyStyle.lineHeight,
                fontFamily: bodyStyle.family,
              }}
            >
              {copyForStructuralError(tierBState.reason)}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
