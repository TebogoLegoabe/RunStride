import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { colors, gradient, radius, shadow } from "../../lib/theme";
import { haptics } from "../../lib/haptics";

type Variant = "primary" | "secondary" | "ghost" | "danger";

type Props = {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const SPRING = { damping: 15, stiffness: 300 };

// The app's button: brand gradient for main actions, outlined for secondary ones,
// red for destructive ones. Shrinks slightly while pressed.
export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  small,
  style,
  accessibilityLabel,
}: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = disabled || loading;
  const textColor =
    variant === "primary" ? colors.heading : variant === "danger" ? colors.heading : variant === "ghost" ? colors.textMuted : colors.primary;

  const content = (
    <View style={[styles.inner, small && styles.innerSmall]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 19} color={textColor} />}
          <Text style={[styles.label, small && styles.labelSmall, { color: textColor }]}>{title}</Text>
        </>
      )}
    </View>
  );

  return (
    <Animated.View style={[animated, inactive && styles.inactive, style]}>
      <Pressable
        onPress={() => {
          if (variant !== "ghost") haptics.tap();
          onPress?.();
        }}
        onPressIn={() => (scale.value = withSpring(0.96, SPRING))}
        onPressOut={() => (scale.value = withSpring(1, SPRING))}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled: !!inactive, busy: !!loading }}
        style={[
          styles.base,
          variant === "primary" && shadow.soft,
          variant === "secondary" && styles.secondary,
          variant === "danger" && styles.danger,
        ]}
      >
        {variant === "primary" ? (
          <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradient}>
            {content}
          </LinearGradient>
        ) : (
          content
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, overflow: "hidden" },
  gradient: { borderRadius: radius.pill },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 22,
  },
  innerSmall: { paddingVertical: 9, paddingHorizontal: 14, gap: 6 },
  label: { fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  labelSmall: { fontSize: 14 },
  secondary: { borderWidth: 1.5, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  inactive: { opacity: 0.5 },
});
