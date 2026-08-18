// CanvasGradient — D13 PR-5 (§5.4).
//
// The vertical canvas gradient: #141110 at the top fading into the flat
// base by the bottom. Mounted as the bottom-most absolute-fill layer of
// a screen whose root keeps the flat base colour as the fallback (so a
// slow first paint or an SVG failure degrades to exactly the old look).
// Decorative only — pointerEvents none, hidden from accessibility.

import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { paletteDark } from '../theme/tokens/color';

export function CanvasGradient() {
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="leiko-canvas" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={paletteDark.canvasGradientTop} />
            <Stop offset="1" stopColor={paletteDark.warmCharcoal[900]} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#leiko-canvas)" />
      </Svg>
    </View>
  );
}
