import { StyleSheet, View } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors, gradient } from "../../lib/theme";

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  action?: { title: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap };
};

// Friendly placeholder for empty lists: an icon in a brand-gradient circle, a title, and a next step
export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <Animated.View entering={FadeInUp.duration(400)} style={styles.wrap}>
      <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
        <Ionicons name={icon} size={34} color={colors.heading} />
      </LinearGradient>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action && (
        <View style={styles.action}>
          <Button title={action.title} icon={action.icon} onPress={action.onPress} variant="secondary" />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingHorizontal: 28, paddingVertical: 40, maxWidth: 420, alignSelf: "center" },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title: { color: colors.heading, fontSize: 21, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  action: { marginTop: 22, alignSelf: "stretch" },
});
