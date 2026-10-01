import { View, StyleSheet, Pressable, ScrollView, Platform } from "react-native";
import { Text } from "../../../components/ui/Text";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Location from "expo-location";
import {
  ApiError,
  getDiscoverFeed,
  getMe,
  getMyProfile,
  getRunningProfile,
  likeRunner,
  passRunner,
  updateLocation,
} from "../../../lib/api";
import { getToken } from "../../../lib/session";
import type { DiscoverCard, MatchSummary, RunningProfile } from "../../../lib/types";
import { Ionicons } from "@expo/vector-icons";
import { SwipeDeck, type SwipeDeckHandle } from "../../../components/SwipeDeck";
import { MatchCelebration } from "../../../components/MatchCelebration";
import { Button } from "../../../components/ui/Button";
import { IconButton } from "../../../components/ui/IconButton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Skeleton } from "../../../components/ui/Skeleton";
import { SafetySheet } from "../../../components/SafetySheet";
import { colors } from "../../../lib/theme";
import { useBreakpoint, useTopPadding } from "../../../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
// Fetch more cards when this few are left
const REFILL_AT = 3;

type Phase = "loading" | "needs-location" | "ready";

async function currentPosition() {
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return coords;
}

export default function Discover() {
  const router = useRouter();
  // Set when opened from a race's Runners section: only people going to that race
  const { raceId, raceName } = useLocalSearchParams<{ raceId?: string; raceName?: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [unverified, setUnverified] = useState(false);
  const [mine, setMine] = useState<RunningProfile | null>(null);
  const [cards, setCards] = useState<DiscoverCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [myPhoto, setMyPhoto] = useState<string | null>(null);
  const deck = useRef<SwipeDeckHandle>(null);
  const { width, height, isPhone, isWide } = useBreakpoint();
  const topPadding = useTopPadding();
  // Size the card so its photo and name fit on short laptop screens, leaving room for the
  // side buttons and navigation
  const room = width - (isWide ? 232 : 76) - 300;
  const deckWidth = isPhone ? undefined : Math.max(280, Math.min(440, (height - topPadding - 360) * 0.8, room));
  // Arrow keys like and pass on computers
  const keyboard = Platform.OS === "web" && !isPhone;

  const loadFeed = useCallback(async (t: string) => {
    try {
      const feed = await getDiscoverFeed(t, raceId);
      // Keep cards already on screen; add new ones after them
      setCards((current) => {
        const seen = new Set(current.map((c) => c.userId));
        return [...current, ...feed.filter((c) => !seen.has(c.userId))];
      });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [raceId]);

  // Switching between everyone and one race starts the feed afresh
  useEffect(() => {
    setCards([]);
  }, [raceId]);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) return; // the (app) layout redirects signed-out users
      setToken(t);
      try {
        const [me, running, profile] = await Promise.all([getMe(t), getRunningProfile(t), getMyProfile(t)]);
        setMyPhoto(profile?.photos[0]?.url ?? null);
        setUnverified(me.verificationStatus !== "verified");
        setMine(running);
        if (!me.hasLocation) {
          setPhase("needs-location");
          return;
        }
        // Quietly keep the stored location current if permission was already given
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.granted) {
          currentPosition()
            .then((c) => updateLocation(t, c.latitude, c.longitude))
            .catch(() => {}); // the last known location is fine if this fails
        }
        await loadFeed(t);
        setPhase("ready");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
        setPhase("ready");
      }
    })();
  }, [loadFeed]);

  const enableLocation = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError("RunStride needs your location to find runners near you. You can allow it in your settings.");
        return;
      }
      const coords = await currentPosition();
      await updateLocation(token, coords.latitude, coords.longitude);
      await loadFeed(token);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't get your location. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Called once a card has flown off. The next card is already showing, so the decision
  // saves in the background; if it fails, the card comes back to the top.
  const decide = async (card: DiscoverCard, liked: boolean) => {
    if (!token) return;
    const remaining = cards.filter((c) => c.userId !== card.userId);
    setCards(remaining);
    if (remaining.length <= REFILL_AT) loadFeed(token);
    try {
      const result = liked ? await likeRunner(token, card.userId) : await passRunner(token, card.userId);
      if (result.matched) setMatch(result.match);
      setError(null);
    } catch (e) {
      // 404 means they're no longer available (e.g. they changed preferences): just move on
      if (!(e instanceof ApiError && e.status === 404)) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
        setCards((current) => [card, ...current.filter((c) => c.userId !== card.userId)]);
      }
    }
  };

  // Web: ← to pass, → to like, unless typing or a sheet is open
  const ready = phase === "ready" && cards.length > 0 && !safetyOpen && !match;
  useEffect(() => {
    if (Platform.OS !== "web" || !ready) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") deck.current?.swipe(false);
      else if (e.key === "ArrowRight") deck.current?.swipe(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  const openMatchChat = () => {
    if (!match) return;
    setMatch(null);
    router.push({
      pathname: "/chat/[matchId]",
      params: { matchId: match.id, userId: match.userId, name: match.displayName, photo: match.photo ?? "" },
    });
  };

  const banner = unverified && (
    <View style={styles.devBanner}>
      <Text style={styles.devBannerTitle}>ID verification: in development</Text>
      <Text style={styles.devBannerText}>
        You're in without verifying for now. Before launch, everyone will verify their ID and a
        selfie before they can match.
      </Text>
    </View>
  );

  if (phase === "loading") {
    return (
      <View style={[styles.container, styles.scroll, { paddingTop: topPadding }]}>
        <View style={[styles.skeletonCard, deckWidth ? { maxWidth: deckWidth } : null]}>
          <Skeleton height={undefined} style={styles.skeletonPhoto} />
          <Skeleton width="40%" height={22} />
          <Skeleton width="70%" height={14} />
        </View>
      </View>
    );
  }

  if (phase === "needs-location") {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        {banner}
        <EmptyState
          icon="location"
          title="Find runners near you"
          body="RunStride uses your location to show people within your distance. Others only ever see roughly how far away you are, never where you are."
        />
        <View style={styles.message}>
          {error && <Text style={styles.error}>{error}</Text>}
          <Button title="Enable location" icon="navigate" onPress={enableLocation} loading={busy} />
        </View>
      </View>
    );
  }

  const card = cards[0];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: topPadding }]}>
        {banner}
        {raceId && (
          <View style={styles.raceFilter}>
            <Ionicons name="flag" size={16} color={colors.pink} />
            <Text style={styles.raceFilterText} numberOfLines={1}>
              Runners at {raceName ?? "this race"}
            </Text>
            <Pressable onPress={() => router.replace("/discover")}>
              <Text style={styles.raceFilterClear}>Show everyone</Text>
            </Pressable>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        {card ? (
          <>
            {/* Bigger screens: pass and like sit either side of the card, always in view */}
            <View style={!isPhone && styles.deckRow}>
              {!isPhone && (
                <View style={styles.sideAction}>
                  <IconButton
                    icon="close"
                    size={68}
                    onPress={() => deck.current?.swipe(false)}
                    accessibilityLabel={`Pass on ${card.displayName}`}
                  />
                  {keyboard && <Text style={styles.keyHint}>←</Text>}
                </View>
              )}
              <View style={[styles.deck, deckWidth ? { width: deckWidth, flexShrink: 1 } : null]}>
                <SwipeDeck
                  ref={deck}
                  cards={cards}
                  mine={mine}
                  onSwiped={decide}
                  onOptions={() => setSafetyOpen(true)}
                />
              </View>
              {!isPhone && (
                <View style={styles.sideAction}>
                  <IconButton
                    icon="heart"
                    size={80}
                    filled
                    onPress={() => deck.current?.swipe(true)}
                    accessibilityLabel={`Like ${card.displayName}`}
                  />
                  {keyboard && <Text style={styles.keyHint}>→</Text>}
                </View>
              )}
            </View>
            <Text style={styles.swipeHint}>
              {keyboard ? "Drag the card, or use the ← and → keys" : "Swipe right to like, left to pass"}
            </Text>
            {isPhone && (
            <View style={styles.actions}>
              <IconButton
                icon="close"
                size={62}
                onPress={() => deck.current?.swipe(false)}
                accessibilityLabel={`Pass on ${card.displayName}`}
              />
              <IconButton
                icon="heart"
                size={74}
                filled
                onPress={() => deck.current?.swipe(true)}
                accessibilityLabel={`Like ${card.displayName}`}
              />
            </View>
            )}
          </>
        ) : (
          <EmptyState
            icon="sparkles"
            title="You're all caught up"
            body={
              raceId
                ? "No more runners at this race match your preferences. Check back as more people join."
                : "No more runners match your preferences nearby right now. Check back later, or widen your age range or distance."
            }
            action={{ title: "Edit preferences", icon: "options-outline", onPress: () => router.push("/dating-preferences") }}
          />
        )}
      </ScrollView>

      {card && (
        <SafetySheet
          visible={safetyOpen}
          token={token}
          person={{ id: card.userId, name: card.displayName }}
          onClose={() => setSafetyOpen(false)}
          onDone={() => {
            // Reported or blocked: they're gone from the feed for good
            setSafetyOpen(false);
            setCards((current) => current.filter((c) => c.userId !== card.userId));
          }}
        />
      )}

      <MatchCelebration
        match={match}
        myPhoto={myPhoto}
        onMessage={openMatchChat}
        onClose={() => setMatch(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 40 },
  deck: { width: "100%", alignSelf: "center" },
  deckRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 40 },
  sideAction: { alignItems: "center", gap: 10 },
  keyHint: { color: colors.textFaint, fontSize: 13, fontWeight: "700" },
  raceFilter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: colors.pinkTint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  raceFilterText: { color: colors.pink, fontWeight: "700", fontSize: 14, flexShrink: 1 },
  raceFilterClear: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
  devBanner: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warningTint,
    alignSelf: "center",
    maxWidth: 420,
    width: "100%",
  },
  devBannerTitle: { color: colors.warningText, fontWeight: "700", fontSize: 14, marginBottom: 4 },
  devBannerText: { color: colors.warningSoft, fontSize: 13, lineHeight: 19 },
  message: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", alignSelf: "center" },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 16, textAlign: "center" },
  swipeHint: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 14 },
  skeletonCard: { width: "100%", maxWidth: 420, alignSelf: "center", gap: 12 },
  skeletonPhoto: { aspectRatio: 4 / 5, borderRadius: 20 },
  actions: { flexDirection: "row", justifyContent: "center", gap: 32, marginTop: 20 },
});
