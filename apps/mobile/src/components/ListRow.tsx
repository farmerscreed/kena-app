// Sourced from docs/03-components/list-row.md (D8 §3.5). 5 variants —
// navigation / toggle / action / data / select — sharing one anatomy:
// optional leading slot, title (type.bodyL), optional subtitle (type.bodyS,
// color.text.secondary), variant-specific trailing, and a 1pt divider below.
//
// Sprint 1 deviation: the spec calls for Phosphor icons (CaretRight 16pt for
// `navigation`, Check 20pt for `select` selected state). We don't ship an
// icon library in Sprint 1 — Phosphor isn't installed and the stack pin
// (docs/00-tech-stack.md) blocks adding one here. Until the icon library
// lands in a later sprint, we render Unicode glyphs ('›' chevron, '✓' check)
// styled with theme colors. Glyph swap is one line per variant.
//
// Toggle variant uses the platform <Switch>, which honours OS Reduce Motion
// natively — we deliberately do NOT animate it ourselves, per the spec's
// "instant toggle" reduced-motion fallback.

import { type ReactNode } from 'react';
import {
  Pressable,
  Switch,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';

export type ListRowVariant = 'navigation' | 'toggle' | 'action' | 'data' | 'select';

export interface ListRowProps {
  variant: ListRowVariant;
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  value?: string;
  selected?: boolean;
  switchValue?: boolean;
  onSwitchChange?: (v: boolean) => void;
  destructive?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  showDivider?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

// Numeric value heuristic — value is rendered in monospace if it parses
// cleanly as a number, optionally with mmHg / bpm / % suffixes that BP
// reading rows commonly show. Spec: "value (type.body-l, monospace if
// numeric)".
function isNumericValue(value: string): boolean {
  return /^-?\d+(\.\d+)?\s*(\/\s*\d+(\.\d+)?)?\s*(mmHg|bpm|%|kg|lbs)?$/i.test(value.trim());
}

function composeA11yLabel(
  title: string,
  subtitle: string | undefined,
  variant: ListRowVariant,
  value: string | undefined,
  override: string | undefined,
): string {
  if (override !== undefined) return override;
  const parts: string[] = [title];
  if (subtitle) parts.push(subtitle);
  if (variant === 'data' && value) parts.push(value);
  return parts.join(', ');
}

export function ListRow({
  variant,
  title,
  subtitle,
  leading,
  value,
  selected = false,
  switchValue = false,
  onSwitchChange,
  destructive = false,
  onPress,
  disabled = false,
  showDivider = true,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const theme = useTheme();
  const titleStyle = theme.type('bodyL');
  const subtitleStyle = theme.type('bodyS');

  const isTappable =
    variant === 'navigation' || variant === 'action' || variant === 'select';

  const titleColor =
    variant === 'action' && destructive
      ? theme.colors.state.urgent
      : theme.colors.text.primary;

  const rowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: theme.listRowMinHeight,
    paddingHorizontal: theme.spacing.l,
    backgroundColor: 'transparent',
  };

  const contentStyle: ViewStyle = {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    opacity: disabled ? theme.opacity.disabled : theme.opacity.full,
  };

  // Premium polish (Sprint 10c.2 polish pass): row titles get a
  // medium weight (500) — bodyL's default 400 reads too casual against
  // the rest of the brand voice. Subtitles drop to text.tertiary +
  // slight tracking for a more refined supporting tier.
  const titleTextStyle: TextStyle = {
    fontSize: titleStyle.size,
    lineHeight: titleStyle.lineHeight,
    fontFamily: theme.fontFamilies.bodyMedium,
    fontWeight: '500',
    color: titleColor,
    letterSpacing: -0.1,
  };

  const subtitleTextStyle: TextStyle = {
    fontSize: subtitleStyle.size,
    lineHeight: subtitleStyle.lineHeight,
    fontFamily: subtitleStyle.family,
    fontWeight: subtitleStyle.weight as TextStyle['fontWeight'],
    color: theme.colors.text.tertiary,
    marginTop: 3,
    letterSpacing: 0.1,
  };

  const dividerStyle: ViewStyle = {
    height: 1,
    backgroundColor: theme.colors.border.subtle,
    marginLeft: theme.spacing.l,
    marginRight: theme.spacing.l,
  };

  const trailing = renderTrailing({
    variant,
    value,
    selected,
    switchValue,
    onSwitchChange,
    disabled,
    theme,
  });

  const body = (
    <View style={contentStyle}>
      {leading ? (
        <View style={{ marginRight: theme.spacing.m }}>{leading}</View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={titleTextStyle}>{title}</Text>
        {subtitle ? <Text style={subtitleTextStyle}>{subtitle}</Text> : null}
      </View>
      {trailing ? (
        <View style={{ marginLeft: theme.spacing.m }}>{trailing}</View>
      ) : null}
    </View>
  );

  const a11yLabel = composeA11yLabel(title, subtitle, variant, value, accessibilityLabel);

  if (variant === 'toggle') {
    // The platform <Switch> is the only switch-roled node — it carries the
    // composed accessibilityLabel and accessibilityState. The visual row
    // around it is decorative; double-roling the wrapper would confuse
    // screen readers and make role queries ambiguous.
    return (
      <View testID={testID}>
        <View style={rowStyle}>
          <View style={contentStyle}>
            {leading ? (
              <View style={{ marginRight: theme.spacing.m }}>{leading}</View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={titleTextStyle}>{title}</Text>
              {subtitle ? <Text style={subtitleTextStyle}>{subtitle}</Text> : null}
            </View>
            <View style={{ marginLeft: theme.spacing.m }}>
              <Switch
                value={switchValue}
                onValueChange={onSwitchChange}
                disabled={disabled}
                accessibilityLabel={a11yLabel}
                accessibilityState={{ checked: switchValue, disabled }}
                testID="listrow-switch"
              />
            </View>
          </View>
        </View>
        {showDivider ? <View style={dividerStyle} /> : null}
      </View>
    );
  }

  if (variant === 'data') {
    // Static, no role.
    return (
      <View testID={testID}>
        <View accessible={true} accessibilityLabel={a11yLabel} style={rowStyle}>
          {body}
        </View>
        {showDivider ? <View style={dividerStyle} /> : null}
      </View>
    );
  }

  // Tappable variants: navigation / action / select.
  if (isTappable) {
    return (
      <View testID={testID}>
        <Pressable
          disabled={disabled}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityState={{ disabled, selected: variant === 'select' ? selected : undefined }}
          accessibilityLabel={a11yLabel}
          style={({ pressed }) => [
            rowStyle,
            pressed && !disabled
              ? { backgroundColor: theme.colors.surface.subtle }
              : null,
          ]}
        >
          {body}
        </Pressable>
        {showDivider ? <View style={dividerStyle} /> : null}
      </View>
    );
  }

  // Fallthrough — should not be reachable given the union, but keeps
  // the function total.
  return (
    <View testID={testID}>
      <View accessible={true} accessibilityLabel={a11yLabel} style={rowStyle}>
        {body}
      </View>
      {showDivider ? <View style={dividerStyle} /> : null}
    </View>
  );
}

interface TrailingArgs {
  variant: ListRowVariant;
  value: string | undefined;
  selected: boolean;
  switchValue: boolean;
  onSwitchChange: ((v: boolean) => void) | undefined;
  disabled: boolean;
  theme: ReturnType<typeof useTheme>;
}

function renderTrailing(args: TrailingArgs): ReactNode {
  const { variant, value, selected, theme } = args;

  if (variant === 'navigation') {
    // Phosphor CaretRight deferred — Unicode '›' (U+203A). Polished to
    // bodyM size + tertiary opacity so the chevron supports rather
    // than competes with the row title.
    const t = theme.type('bodyM');
    const style: TextStyle = {
      fontSize: t.size,
      lineHeight: t.lineHeight,
      color: theme.colors.text.tertiary,
    };
    return (
      <Text style={style} testID="listrow-chevron">
        {'›'}
      </Text>
    );
  }

  if (variant === 'data' && value) {
    // Polished: smaller (bodyM not bodyL) + secondary color so the
    // value is supporting info, not co-equal to the title.
    const t = theme.type('bodyM');
    const numeric = isNumericValue(value);
    const style: TextStyle = {
      fontSize: t.size,
      lineHeight: t.lineHeight,
      fontFamily: numeric ? theme.fontFamilies.numeric : t.family,
      fontWeight: '400',
      color: theme.colors.text.secondary,
      textAlign: 'right',
    };
    return (
      <Text style={style} testID="listrow-value">
        {value}
      </Text>
    );
  }

  if (variant === 'select') {
    // Select rows used as "edit this field" entries (Settings → Profile)
    // need to surface the current value alongside the title — without
    // it, the user can't tell which fields are filled vs empty. We
    // render value text + an optional check (for picker rows where
    // `selected` represents an active choice in a multi-choice list).
    // Phosphor Check deferred — Unicode '✓' (U+2713). Replace when the
    // icon library lands.
    const valueType = theme.type('bodyM');
    const checkType = theme.type('bodyL');
    const valueStyle: TextStyle = {
      fontSize: valueType.size,
      lineHeight: valueType.lineHeight,
      fontFamily: isNumericValue(value ?? '')
        ? theme.fontFamilies.numeric
        : valueType.family,
      color: theme.colors.text.secondary,
      textAlign: 'right',
      // Reserve space so very long values truncate rather than push
      // the title off-screen on small phones.
      maxWidth: 180,
    };
    const checkStyle: TextStyle = {
      fontSize: checkType.size,
      lineHeight: checkType.lineHeight,
      color: theme.colors.brand.primary,
      fontWeight: '600',
      marginLeft: value ? 8 : 0,
    };
    if (!value && !selected) return null;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {value ? (
          <Text style={valueStyle} numberOfLines={1} testID="listrow-value">
            {value}
          </Text>
        ) : null}
        {selected ? (
          <Text style={checkStyle} testID="listrow-check">
            {'✓'}
          </Text>
        ) : null}
      </View>
    );
  }

  return null;
}

