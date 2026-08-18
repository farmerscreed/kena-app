// LoadingState — Sprint 16 (offline + error states).
//
// Shared loading-state component. Renders an ActivityIndicator + an
// optional calm caption. Used by every screen that fetches async
// data: vital details, Trends, Family Members, Audit Log.
//
// Voice: any caption passed in must pass voice-lint. Default omits
// the caption entirely — silent spinners are calm.

import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';

export interface LoadingStateProps {
  /** Optional caption shown under the spinner. */
  caption?: string;
  /** Container padding override. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function LoadingState({ caption, style, testID }: LoadingStateProps) {
  const theme = useTheme();
  return (
    <View accessible={true}
      style={[
        styles.root,
        { padding: theme.spacing.xl, gap: theme.spacing.s },
        style,
      ]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={caption ?? 'Loading'}
    >
      <ActivityIndicator color={theme.colors.brand.primary} />
      {caption ? (
        <Text
          style={[
            theme.type('bodyM'),
            { color: theme.colors.text.tertiary, textAlign: 'center' },
          ]}
          testID={testID ? `${testID}-caption` : undefined}
        >
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
});
