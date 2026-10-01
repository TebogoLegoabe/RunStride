import { Pressable, StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, gradient, shadow } from "../../lib/theme";

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
  // filled: brand gradient; plain: dark circle
  filled?: boolean;
  color?: string;
  disabled?: boolean;
  accessibilityLabel: string;
};

const SPRING = { damping: 12, stiffness: 320 };

// Round icon button with a springy press and a small "pop" when tapped (Discover's like / pass).
export function IconButton({ icon, onPress, size = 64, filled, color, disabled, accessibilityLabel }: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const iconColor = color ?? (filled ? colors.heading : colors.textBright);
  const circle = { width: size, height: size, borderRadius: size / 2 };

  return (
    <Animated.View style={[animated, shadow.card, { borderRadius: size / 2 }, disabled && styles.disabled]}>
      <Pressable
        onPress={() => {
          scale.value = withSequence(withSpring(1.12, SPRING), withSpring(1, SPRING));
          onPress();
        }}
        onPressIn={() => (scale.value = withSpring(0.9, SPRING))}
        onPressOut={() => (scale.value = withSpring(1, SPRING))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {filled ? (
          <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.center, circle]}>
            <Ionicons name={icon} size={size * 0.46} color={iconColor} />
          </LinearGradient>
        ) : (
          <Animated.View style={[styles.center, styles.plain, circle]}>
            <Ionicons name={icon} size={size * 0.42} color={iconColor} />
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  plain: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.5 },
});
