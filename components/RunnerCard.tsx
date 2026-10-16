import { View, Image, Pressable, StyleSheet, ScrollView } from "react-native";
import { Text } from "./ui/Text";
import { useState } from "react";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { mediaUrl } from "../lib/api";
import { formatPace, labelFor } from "../lib/format";
import { GOALS, RUN_TIMES, TERRAINS } from "../lib/options";
import type { DiscoverCard, RunningProfile } from "../lib/types";
import { colors, fonts } from "../lib/theme";

type Props = {
  card: DiscoverCard;
  // The viewer's own running profile, to highlight what they have in common
  mine: RunningProfile | null;
  // Opens report/block options
  onOptions?: () => void;
};

// A runner as a full-bleed photo card that fills whatever space it's given, so Discover fits
// on one screen. The key facts sit on the photo; the info button opens everything else.
export function RunnerCard({ card, mine, onOptions }: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [photoWidth, setPhotoWidth] = useState(0);
  const [info, setInfo] = useState(false);
  const photoCount = card.photos.length;

  // Tap the right half for the next photo, the left half for the previous one
  const onPhotoPress = (x: number, width: number) => {
    if (photoCount < 2) return;
    setPhotoIndex((i) => (x > width / 2 ? Math.min(i + 1, photoCount - 1) : Math.max(i - 1, 0)));
  };

  const tags = [
    ...card.goals.map((g) => ({ key: `g-${g}`, label: labelFor(GOALS, g), shared: !!mine?.goals.includes(g) })),
    ...card.terrains.map((t) => ({ key: `t-${t}`, label: labelFor(TERRAINS, t), shared: !!mine?.terrains.includes(t) })),
    ...card.runTimes.map((r) => ({ key: `r-${r}`, label: labelFor(RUN_TIMES, r), shared: !!mine?.runTimes.includes(r) })),
  ];
  const firstRace = card.sharedRaces[0];
  const moreRaces = card.sharedRaces.length - 1;

  return (
    <View style={styles.card}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => onPhotoPress(e.nativeEvent.locationX, photoWidth)}
        onLayout={(e) => setPhotoWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Photo ${photoIndex + 1} of ${photoCount}`}
      >
        <Image source={{ uri: mediaUrl(card.photos[photoIndex]) }} style={styles.photo} resizeMode="cover" />
      </Pressable>

      {photoCount > 1 && (
        <View style={styles.photoBars} pointerEvents="none">
          {card.photos.map((_, i) => (
            <View key={i} style={[styles.photoBar, i === photoIndex && styles.photoBarOn]} />
          ))}
        </View>
      )}
      {onOptions && (
        <Pressable style={styles.optionsButton} onPress={onOptions} accessibilityLabel={`Report or block ${card.displayName}`}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.heading} />
        </Pressable>
      )}

      <LinearGradient colors={["transparent", colors.scrimStronger]} style={styles.footer} pointerEvents="box-none">
        <View style={styles.footerRow} pointerEvents="box-none">
          <View style={styles.footerText} pointerEvents="none">
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {card.displayName}, {card.age}
              </Text>
              {card.verified && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}
            </View>
            <View style={styles.badges}>
              {card.likesYou && (
                <View style={[styles.badge, styles.likesYou]}>
                  <Ionicons name="heart" size={12} color={colors.heading} />
                  <Text style={styles.badgeText}>Likes you</Text>
                </View>
              )}
              <View style={[styles.badge, styles.match]}>
                <Text style={styles.badgeText}>{card.compatibility}% running match</Text>
              </View>
            </View>
            <Text style={styles.facts} numberOfLines={1}>
              <Ionicons name="location-outline" size={13} color={colors.textBright} /> {card.distanceKm} km ·{" "}
              {formatPace(card.paceSecondsPerKm)} /km · {card.weeklyKm} km/week
            </Text>
            {card.sharedClubs.length > 0 ? (
              <Text style={styles.club} numberOfLines={1}>
                <Ionicons name="people" size={13} color={colors.primary} /> You both run with {card.sharedClubs[0]}
              </Text>
            ) : card.clubs.length > 0 ? (
              <Text style={styles.clubPlain} numberOfLines={1}>
                <Ionicons name="people-outline" size={13} color={colors.textBright} /> {card.clubs.join(" · ")}
              </Text>
            ) : null}
            {firstRace && (
              <Text style={styles.race} numberOfLines={1}>
                <Ionicons name="flag" size={13} color={colors.pink} /> Also at {firstRace.name}
                {firstRace.eventLabel ? ` · ${firstRace.eventLabel}` : ""}
                {moreRaces > 0 ? ` +${moreRaces} more` : ""}
              </Text>
            )}
          </View>
          <Pressable
            style={styles.infoButton}
            onPress={() => setInfo(true)}
            accessibilityLabel={`More about ${card.displayName}`}
            hitSlop={8}
          >
            <Ionicons name="information" size={20} color={colors.heading} />
          </Pressable>
        </View>
      </LinearGradient>

      {info && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={styles.infoPanel}>
          <View style={styles.infoHeader}>
            <Text style={styles.infoName}>
              {card.displayName}, {card.age}
            </Text>
            <Pressable onPress={() => setInfo(false)} accessibilityLabel="Close details" hitSlop={10}>
              <Ionicons name="chevron-down-circle" size={30} color={colors.heading} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.infoBody} showsVerticalScrollIndicator={false}>
            {card.bio && <Text style={styles.bio}>{card.bio}</Text>}
            <View style={styles.statsRow}>
              <Text style={styles.stat}>
                <Ionicons name="speedometer-outline" size={14} color={colors.textMuted} />{" "}
                {formatPace(card.paceSecondsPerKm)} /km
              </Text>
              <Text style={styles.stat}>
                <Ionicons name="trending-up-outline" size={14} color={colors.textMuted} /> {card.weeklyKm} km/week
              </Text>
              <Text style={styles.stat}>
                <Ionicons name="location-outline" size={14} color={colors.textMuted} /> {card.distanceKm} km away
              </Text>
            </View>
            {card.clubs.length > 0 && (
              <View style={styles.infoSection}>
                <Text style={styles.infoLabel}>Runs with</Text>
                <View style={styles.tags}>
                  {card.clubs.map((club) => {
                    const shared = card.sharedClubs.includes(club);
                    return (
                      <View key={club} style={[styles.tag, shared && styles.tagShared]}>
                        <Text style={[styles.tagText, shared && styles.tagTextShared]}>
                          {shared ? `${club} · your club too` : club}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
            {card.sharedRaces.length > 0 && (
              <View style={styles.infoSection}>
                <Text style={styles.infoLabel}>Races you're both going to</Text>
                {card.sharedRaces.map((race) => (
                  <Text key={race.raceId} style={styles.infoRace}>
                    <Ionicons name="flag" size={13} color={colors.pink} /> {race.name}
                    {race.eventLabel ? ` · ${race.eventLabel}` : ""}
                  </Text>
                ))}
              </View>
            )}
            <View style={styles.infoSection}>
              <Text style={styles.infoLabel}>Runs (highlighted: you too)</Text>
              <View style={styles.tags}>
                {tags.map((t) => (
                  <View key={t.key} style={[styles.tag, t.shared && styles.tagShared]}>
                    <Text style={[styles.tagText, t.shared && styles.tagTextShared]}>{t.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  club: { color: colors.heading, fontSize: 13, fontWeight: "700", marginTop: 2 },
  clubPlain: { color: colors.textBright, fontSize: 13, marginTop: 2 },
  card: { flex: 1, width: "100%", borderRadius: 22, overflow: "hidden", backgroundColor: colors.border },
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
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingTop: 80 },
  footerRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  footerText: { flex: 1, minWidth: 0, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.heading, fontSize: 26, fontFamily: fonts.extrabold, flexShrink: 1 },
  badges: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  match: { backgroundColor: colors.primary },
  // Only Plus members see who already likes them
  likesYou: { backgroundColor: colors.pink },
  badgeText: { color: colors.heading, fontSize: 12, fontFamily: fonts.bold },
  facts: { color: colors.textBright, fontSize: 14 },
  race: { color: colors.pink, fontSize: 13, fontFamily: fonts.bold },
  infoButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.scrimStrong,
    borderWidth: 1,
    borderColor: colors.photoBarDim,
    alignItems: "center",
    justifyContent: "center",
  },
  infoPanel: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdropStrong, padding: 18 },
  infoHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  infoName: { color: colors.heading, fontSize: 22, fontFamily: fonts.extrabold, flexShrink: 1 },
  infoBody: { gap: 16, paddingBottom: 12 },
  bio: { color: colors.textBright, fontSize: 15, lineHeight: 22 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  stat: { color: colors.text, fontSize: 14 },
  infoSection: { gap: 6 },
  infoLabel: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.bold, textTransform: "uppercase", letterSpacing: 0.6 },
  infoRace: { color: colors.pink, fontSize: 14, fontFamily: fonts.semibold },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.border },
  tagShared: { backgroundColor: colors.primary },
  tagText: { color: colors.text, fontSize: 13 },
  tagTextShared: { color: colors.onPrimary, fontFamily: fonts.semibold },
});
