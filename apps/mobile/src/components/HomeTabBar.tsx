// HomeTabBar — ADR-0006 Phase 3.
//
// The bottom navigation bar for the home: Home · Trends · [+ Take a
// reading] · Learn · Settings, with the centre "+" as a distinct round
// coral button. Extracted verbatim from the original SelfBuyerHome inline
// tab bar so the unified constellation home and the legacy self-buyer
// home share ONE implementation and one look (D11 premium-precise).
//
// Pure presentational — the screen wires `onSelect` to navigation and
// passes which tab is `active`.

import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { MAX_FONT_SCALE_TIGHT } from '../theme/fontScaling';

export type HomeTab = 'home' | 'trends' | 'take_reading' | 'learn' | 'settings';

export interface HomeTabBarProps {
  onSelect: (tab: HomeTab) => void;
  /** Which side tab is highlighted. Defaults to 'home'. */
  active?: Exclude<HomeTab, 'take_reading'>;
  testID?: string;
}

export function HomeTabBar({ onSelect, active = 'home', testID }: HomeTabBarProps) {
  const theme = useTheme();
  const sideTabs: Array<{ id: Exclude<HomeTab, 'take_reading'>; label: string }> = [
    { id: 'home', label: 'Home' },
    { id: 'trends', label: 'Trends' },
    { id: 'learn', label: 'Learn' },
    { id: 'settings', label: 'Settings' },
  ];
  const leftSide = sideTabs.slice(0, 2);
  const rightSide = sideTabs.slice(2);
  const labelStyle = theme.type('labelUppercase');
  const rootTestID = testID ?? 'home-tab-bar';

  const renderTab = (t: { id: Exclude<HomeTab, 'take_reading'>; label: string }) => {
    const isActive = t.id === active;
    return (
      <Pressable
        key={t.id}
        onPress={() => onSelect(t.id)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        accessibilityLabel={t.label}
        hitSlop={8}
        testID={`${rootTestID}-tab-${t.id}`}
        style={({ pressed }) => ({
          // Tight horizontal padding so all 4 labels + the centre button
          // fit on narrow screens (Settings was pushed off the right edge
          // at spacing.l). hitSlop keeps the tap target comfortable.
          paddingHorizontal: theme.spacing.xs,
          paddingVertical: theme.spacing.s,
          borderRadius: 16,
          opacity: pressed ? 0.7 : 1,
          flexShrink: 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          numberOfLines={1}
          style={{
            fontFamily: labelStyle.family,
            fontSize: labelStyle.size,
            lineHeight: labelStyle.lineHeight,
            letterSpacing: labelStyle.letterSpacing,
            textTransform: 'uppercase',
            color: isActive ? theme.colors.brand.coral : theme.colors.text.tertiary,
          }}
        >
          {t.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View
      accessibilityRole="tablist"
      style={{
        position: 'absolute',
        left: theme.spacing.m,
        right: theme.spacing.m,
        bottom: theme.spacing.xxl,
        height: 60,
        borderRadius: 28,
        backgroundColor: theme.colors.surface.warmElevated,
        borderWidth: 0.5,
        borderColor: theme.colors.border.rim,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingHorizontal: theme.spacing.xs,
        ...theme.elevation.high.ios,
        ...theme.elevation.high.android,
      }}
      testID={rootTestID}
    >
      {leftSide.map(renderTab)}

      {/* Centre stage — Take a reading. Distinct round elevated button
          (D11 premium-precise; brand-coral primary). Sits BETWEEN Trends
          (left) and Learn (right). */}
      <Pressable
        onPress={() => onSelect('take_reading')}
        accessibilityRole="button"
        accessibilityLabel="Take a reading"
        accessibilityHint="Walks you through taking a reading on your watch"
        hitSlop={8}
        testID={`${rootTestID}-tab-take_reading`}
        style={({ pressed }) => ({
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: pressed
            ? theme.colors.brand.primaryPressed
            : theme.colors.brand.coral,
          alignItems: 'center',
          justifyContent: 'center',
          marginHorizontal: theme.spacing.s,
          ...theme.elevation.medium.ios,
          ...theme.elevation.medium.android,
        })}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE_TIGHT}
          style={{
            fontFamily: theme.fontFamilies.display,
            fontSize: 26,
            lineHeight: 26,
            color: theme.colors.text.onBrand,
          }}
        >
          +
        </Text>
      </Pressable>

      {rightSide.map(renderTab)}
    </View>
  );
}
