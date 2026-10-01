import { View, Image, Pressable, StyleSheet } from "react-native";
import { Text } from "./ui/Text";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { mediaUrl } from "../lib/api";
import { formatPace, labelFor } from "../lib/format";
import { GOALS, RUN_TIMES, TERRAINS } from "../lib/options";
import type { DiscoverCard, RunningProfile } from "../lib/types";
import { colors } from "../lib/theme";

type Props = {
  card: DiscoverCard;
  // The viewer's own running profile, to highlight what they have in common
  mine: RunningProfile | null;
  // Opens report/block options
  onOptions?: () => void;
};

export function RunnerCard({ card, mine, onOptions }: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoWidth, setPhotoWidth] = useState(0);
  const photoCount = card.photos.length;

  // Tap the right half for the next photo, the left half for the previous one
  const onPhotoPress = (x: number, width: number) => {
    if (photoCount < 2) return;
    setPhotoIndex((i) => (x > width / 2 ? Math.min(i + 1, photoCount - 1) : Math.max(i - 1, 0)));
  };

  const tags = [
    ...card.goals.map((g) => ({ key: `g-${g}`, label: labelFor(GOALS, g), shared: !!mine?.goals.includes(g) })),
    ...card.terrains.map((t) => ({
      key: `t-${t}`,
      label: labelFor(TERRAINS, t),
      shared: !!mine?.terrains.includes(t),
    })),
    ...card.runTimes.map((r) => ({
      key: `r-${r}`,
      label: labelFor(RUN_TIMES, r),
      shared: !!mine?.runTimes.includes(r),
    })),
  ];

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.photoWrap}
        onPress={(e) => onPhotoPress(e.nativeEvent.locationX, photoWidth)}
        onLayout={(e) => setPhotoWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Photo ${photoIndex + 1} of ${photoCount}`}
      >
        <Image source={{ uri: mediaUrl(card.photos[photoIndex]) }} style={styles.photo} />
        {photoCount > 1 && (
          <View style={styles.photoBars}>
            {card.photos.map((_, i) => (
              <View key={i} style={[styles.photoBar, i === photoIndex && styles.photoBarOn]} />
            ))}
          </View>
        )}
        {onOptions && (
          <Pressable
            style={styles.optionsButton}
            onPress={onOptions}
            accessibilityLabel={`Report or block ${card.displayName}`}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.heading} />
          </Pressable>
        )}
        <LinearGradient
          colors={["transparent", colors.scrimStronger]}
          style={styles.photoFooter}
          pointerEvents="none"
        >
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {card.displayName}, {card.age}
            </Text>
            {card.verified && (
              <View style={styles.verified}>
                <Ionicons name="checkmark-circle" size={14} color={colors.onPrimary} />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
          </View>
          <View style={styles.distanceRow}>
            <Ionicons name="location-outline" size={14} color={colors.textBright} />
            <Text style={styles.distance}>{card.distanceKm} km away</Text>
          </View>
        </LinearGradient>
      </Pressable>

      <View style={styles.details}>
        {card.sharedRaces.map((race) => (
          <View key={race.raceId} style={styles.raceBadge}>
            <Text style={styles.raceBadgeText}>
              <Ionicons name="flag" size={13} color={colors.pink} />{" "}
              Also at {race.name}
              {race.eventLabel ? ` · ${race.eventLabel}` : ""}
            </Text>
          </View>
        ))}
        <View style={styles.statsRow}>
          <View style={styles.matchPill}>
            <Text style={styles.matchText}>{card.compatibility}% running match</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="speedometer-outline" size={15} color={colors.textMuted} />
            <Text style={styles.statText}>{formatPace(card.paceSecondsPerKm)} /km</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="trending-up-outline" size={15} color={colors.textMuted} />
            <Text style={styles.statText}>{card.weeklyKm} km/week</Text>
          </View>
        </View>

        <View style={styles.tags}>
          {tags.map((t) => (
            <View key={t.key} style={[styles.tag, t.shared && styles.tagShared]}>
              <Text style={[styles.tagText, t.shared && styles.tagTextShared]}>{t.label}</Text>
            </View>
          ))}
        </View>

        {card.bio && <Text style={styles.bio}>{card.bio}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  photoWrap: { width: "100%", aspectRatio: 4 / 5, backgroundColor: colors.border },
  photo: { width: "100%", height: "100%" },
  photoBars: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", gap: 4 },
  photoBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.photoBarDim },
  photoBarOn: { backgroundColor: colors.heading },
  optionsButton: {
    position: "absolute",
    top: 22,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.scrimStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  photoFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingTop: 70,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  name: { color: colors.heading, fontSize: 26, fontWeight: "700" },
  verified: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  verifiedText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  distanceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  distance: { color: colors.textBright, fontSize: 14 },
  details: { padding: 16 },
  raceBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.pinkTint,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  raceBadgeText: { color: colors.pink, fontSize: 13, fontWeight: "700" },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  matchPill: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  matchText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  stat: { flexDirection: "row", alignItems: "center", gap: 5 },
  statText: { color: colors.text, fontSize: 14 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.border },
  tagShared: { backgroundColor: colors.primary },
  tagText: { color: colors.text, fontSize: 13 },
  tagTextShared: { color: colors.onPrimary, fontWeight: "600" },
  bio: { color: colors.textBright, fontSize: 15, lineHeight: 21 },
});
