// "3 people like you": who, with Plus (they're also shown first in Discover); just the
// number without it.
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { mediaUrl } from "../lib/api";
import { hoverable } from "../lib/responsive";
import { openPlus } from "../lib/upsell";
import type { LikesYou } from "../lib/types";
import { colors, fonts, gradient, radius } from "../lib/theme";

export function LikesYouCard({ likes }: { likes: LikesYou }) {
  const router = useRouter();
  if (likes.count === 0) return null;
  const revealed = likes.people.length > 0;
  const shown = Math.min(likes.count, 4);

  return (
    <Pressable
      onPress={() =>
        revealed
          ? router.navigate("/discover")
          : openPlus(router, { reason: "See who already likes you. With Plus they're shown first in Discover." })
      }
      accessibilityRole="button"
      style={hoverable(({ hovered }) => [styles.card, hovered && styles.cardHover])}
    >
      <View style={styles.faces}>
        {Array.from({ length: shown }, (_, i) => {
          const person = likes.people[i];
          return (
            <View key={i} style={[styles.face, { marginLeft: i === 0 ? 0 : -14, zIndex: shown - i }]}>
              {person?.photo ? (
                <Image source={{ uri: mediaUrl(person.photo) }} style={styles.photo} />
              ) : (
                // Without Plus: a heart where the face would be
                <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.photo}>
                  <Ionicons name="heart" size={18} color={colors.heading} />
                </LinearGradient>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>
          {likes.count} {likes.count === 1 ? "person likes" : "people like"} you
        </Text>
        <Text style={styles.body}>
          {revealed ? "They're first in your Discover. Like them back to match." : "See who with Plus"}
        </Text>
      </View>
      <Ionicons name={revealed ? "chevron-forward" : "lock-closed"} size={18} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.pink,
    padding: 14,
    marginBottom: 14,
  },
  cardHover: { backgroundColor: colors.border },
  faces: { flexDirection: "row" },
  face: { borderRadius: 22, borderWidth: 2, borderColor: colors.surface },
  photo: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  text: { flex: 1 },
  title: { color: colors.heading, fontSize: 16, fontFamily: fonts.bold },
  body: { color: colors.textMuted, fontSize: 13, marginTop: 1 },
});
