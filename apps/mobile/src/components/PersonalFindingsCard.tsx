// PersonalFindingsCard — the cross-vital matrix's per-vital surface
// (founder-commissioned 2026-08-19). For each pair relevant to this
// vital it renders exactly one of three honest states:
//
//   found            → the engine's own narrative (server voice-linted)
//   honest negative  → §7.5: we looked, no pattern, that's common
//   counting         → the §6.6 progress rule toward n = 14
//
// The engine's gates (n≥14, |r|≥0.3, p<0.05) decide which — this card
// never computes statistics and never upgrades a state.

import { useQuery } from '@tanstack/react-query';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE, MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';
import { supabase } from '../services/supabase';
import { CorrelationCountdown } from './CorrelationCountdown';
import { CORRELATION_MIN_N } from '../services/voice/correlationCopy';

export type MatrixPair =
  | 'sleep_x_morning_bp'
  | 'activity_x_resting_hr'
  | 'spo2_dip_x_sleep_score'
  | 'sleep_x_resting_hr'
  | 'activity_x_morning_bp'
  | 'after_meds_x_bp';

/** Plain-language pair names for the generic honest negative. */
const PAIR_LABEL: Record<MatrixPair, [string, string]> = {
  sleep_x_morning_bp: ['sleep', 'the morning readings'],
  activity_x_resting_hr: ['daily movement', 'resting heart rate'],
  spo2_dip_x_sleep_score: ['overnight oxygen', 'sleep'],
  sleep_x_resting_hr: ['sleep', 'resting heart rate'],
  activity_x_morning_bp: ['daily movement', 'the next morning’s readings'],
  after_meds_x_bp: ['readings tagged after meds', 'the rest'],
};

interface FindingRow {
  correlation_type: string;
  is_meaningful: boolean;
  sample_n: number;
  narrative_long: string | null;
  computed_at: string;
}

export interface PersonalFindingsCardProps {
  familyId: string | null;
  pairs: MatrixPair[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** §7.5-shaped generic honest negative. */
export function honestNegativeLine(pair: MatrixPair, n: number): string {
  const [a, b] = PAIR_LABEL[pair];
  return `We looked at ${a} and ${b} across ${n} days and didn't find a pattern. That's common, and it isn't a problem.`;
}

export function PersonalFindingsCard({
  familyId,
  pairs,
  testID = 'personal-findings',
  style,
}: PersonalFindingsCardProps) {
  const theme = useTheme();
  const query = useQuery({
    queryKey: ['vital-findings', familyId, pairs.join(',')],
    enabled: familyId != null,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<FindingRow[]> => {
      const res = await supabase
        .from('correlations')
        .select('correlation_type, is_meaningful, sample_n, narrative_long, computed_at')
        .eq('family_id', familyId as string)
        .in('correlation_type', pairs)
        .order('computed_at', { ascending: false })
        .limit(pairs.length * 6);
      const rows = ((res.data ?? []) as unknown as FindingRow[]);
      const latest = new Map<string, FindingRow>();
      for (const row of rows) {
        if (!latest.has(row.correlation_type)) latest.set(row.correlation_type, row);
      }
      return [...latest.values()];
    },
  });

  const rows = query.data ?? [];
  if (!familyId || rows.length === 0) return null;
  const bodyM = theme.type('bodyM');

  return (
    <View
      style={[
        {
          marginHorizontal: 20,
          marginTop: theme.spacing.l,
          padding: theme.spacing.l,
          backgroundColor: theme.colors.surface.warmElevated,
          borderRadius: theme.radii.l,
        },
        style,
      ]}
      testID={testID}
    >
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
        In your own data
      </Text>
      {rows.map((row) => {
        const pair = row.correlation_type as MatrixPair;
        if (row.is_meaningful && row.narrative_long) {
          return (
            <Text
              key={pair}
              accessible={true}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[bodyM, { color: theme.colors.text.primary, marginTop: 6 }]}
              testID={`${testID}-found-${pair}`}
            >
              {row.narrative_long}
            </Text>
          );
        }
        if (row.sample_n >= CORRELATION_MIN_N) {
          return (
            <Text
              key={pair}
              accessible={true}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[bodyM, { color: theme.colors.text.secondary, marginTop: 6 }]}
              testID={`${testID}-negative-${pair}`}
            >
              {honestNegativeLine(pair, row.sample_n)}
            </Text>
          );
        }
        return (
          <CorrelationCountdown
            key={pair}
            pairedNights={row.sample_n}
            testID={`${testID}-counting-${pair}`}
            style={{ marginHorizontal: 0 }}
          />
        );
      })}
    </View>
  );
}
