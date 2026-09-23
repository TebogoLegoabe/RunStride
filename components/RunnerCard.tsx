import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import { useState } from "react";
import { mediaUrl } from "../lib/api";
import { formatPace, labelFor } from "../lib/format";
import { GOALS, RUN_TIMES, TERRAINS } from "../lib/options";
import type { DiscoverCard, RunningProfile } from "../lib/types";

type Props = {
  card: DiscoverCard;
  // The viewer's own running profile, to highlight what they have in common
  mine: RunningProfile | null;
};

export function RunnerCard({ card, mine }: Props) {
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
        <View style={styles.photoFooter}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {card.displayName}, {card.age}
            </Text>
            {card.verified && <Text style={styles.verified}>✓ Verified</Text>}
          </View>
          <Text style={styles.distance}>{card.distanceKm} km away</Text>
        </View>
      </Pressable>

      <View style={styles.details}>
        <View style={styles.statsRow}>
          <View style={styles.matchPill}>
            <Text style={styles.matchText}>{card.compatibility}% running match</Text>
          </View>
          <Text style={styles.stat}>{formatPace(card.paceSecondsPerKm)} /km</Text>
          <Text style={styles.stat}>{card.weeklyKm} km/week</Text>
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
    backgroundColor: "#1e293b",
  },
  photoWrap: { width: "100%", aspectRatio: 4 / 5, backgroundColor: "#334155" },
  photo: { width: "100%", height: "100%" },
  photoBars: { position: "absolute", top: 10, left: 10, right: 10, flexDirection: "row", gap: 4 },
  photoBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)" },
  photoBarOn: { backgroundColor: "#ffffff" },
  photoFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingTop: 40,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  name: { color: "#ffffff", fontSize: 26, fontWeight: "700" },
  verified: {
    color: "#0f172a",
    backgroundColor: "#4ecdc4",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },
  distance: { color: "#e2e8f0", fontSize: 14, marginTop: 2 },
  details: { padding: 16 },
  statsRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  matchPill: {
    backgroundColor: "rgba(78, 205, 196, 0.15)",
    borderColor: "#4ecdc4",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  matchText: { color: "#4ecdc4", fontWeight: "700", fontSize: 13 },
  stat: { color: "#cbd5e1", fontSize: 14 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#334155" },
  tagShared: { backgroundColor: "#4ecdc4" },
  tagText: { color: "#cbd5e1", fontSize: 13 },
  tagTextShared: { color: "#0f172a", fontWeight: "600" },
  bio: { color: "#e2e8f0", fontSize: 15, lineHeight: 21 },
});
