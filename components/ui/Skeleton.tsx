import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors, radius } from "../../lib/theme";

type Props = { width?: DimensionValue; height?: DimensionValue; round?: boolean; style?: StyleProp<ViewStyle> };

// A softly pulsing placeholder shown where content is loading
export function Skeleton({ width = "100%", height = 16, round, style }: Props) {
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.9, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[styles.base, { width, height, borderRadius: round ? 999 : radius.sm }, animated, style]}
    />
  );
}

// Placeholder for a list row with an avatar and two lines of text
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={52} height={52} round />
      <View style={styles.lines}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="85%" height={12} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.border },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  lines: { flex: 1, gap: 8 },
});
