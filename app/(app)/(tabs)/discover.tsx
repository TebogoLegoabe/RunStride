import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Image, Modal } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import {
  ApiError,
  getDiscoverFeed,
  getMe,
  getRunningProfile,
  likeRunner,
  mediaUrl,
  passRunner,
  updateLocation,
} from "../../../lib/api";
import { getToken } from "../../../lib/session";
import type { DiscoverCard, MatchSummary, RunningProfile } from "../../../lib/types";
import { RunnerCard } from "../../../components/RunnerCard";

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
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [unverified, setUnverified] = useState(false);
  const [mine, setMine] = useState<RunningProfile | null>(null);
  const [cards, setCards] = useState<DiscoverCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);

  const loadFeed = useCallback(async (t: string) => {
    try {
      const feed = await getDiscoverFeed(t);
      // Keep cards already on screen; add new ones after them
      setCards((current) => {
        const seen = new Set(current.map((c) => c.userId));
        return [...current, ...feed.filter((c) => !seen.has(c.userId))];
      });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) return; // the (app) layout redirects signed-out users
      setToken(t);
      try {
        const [me, running] = await Promise.all([getMe(t), getRunningProfile(t)]);
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

  const decide = async (liked: boolean) => {
    const card = cards[0];
    if (!token || !card || busy) return;
    setBusy(true);
    try {
      const result = liked ? await likeRunner(token, card.userId) : await passRunner(token, card.userId);
      if (result.matched) setMatch(result.match);
    } catch (e) {
      // 404 means they're no longer available (e.g. they changed preferences): just move on
      if (!(e instanceof ApiError && e.status === 404)) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
        setBusy(false);
        return;
      }
    }
    const remaining = cards.slice(1);
    setCards(remaining);
    setBusy(false);
    if (remaining.length <= REFILL_AT) loadFeed(token);
  };

  const openMatchChat = () => {
    if (!match) return;
    setMatch(null);
    router.push({
      pathname: "/chat/[matchId]",
      params: { matchId: match.id, name: match.displayName, photo: match.photo ?? "" },
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
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#4ecdc4" />
      </View>
    );
  }

  if (phase === "needs-location") {
    return (
      <View style={styles.container}>
        {banner}
        <View style={styles.message}>
          <Text style={styles.title}>Find runners near you</Text>
          <Text style={styles.body}>
            RunStride uses your location to show people within your distance. Others only ever
            see roughly how far away you are, never where you are.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            onPress={enableLocation}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.primaryButtonText}>Enable location</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  const card = cards[0];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {banner}
        {error && <Text style={styles.error}>{error}</Text>}

        {card ? (
          <>
            <RunnerCard key={card.userId} card={card} mine={mine} />
            <View style={styles.actions}>
              <Pressable
                style={[styles.actionButton, styles.passButton]}
                onPress={() => decide(false)}
                disabled={busy}
                accessibilityLabel={`Pass on ${card.displayName}`}
              >
                <Text style={styles.passIcon}>✕</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.likeButton]}
                onPress={() => decide(true)}
                disabled={busy}
                accessibilityLabel={`Like ${card.displayName}`}
              >
                <Text style={styles.likeIcon}>♥</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.message}>
            <Text style={styles.title}>You're all caught up</Text>
            <Text style={styles.body}>
              No more runners match your preferences nearby right now. Check back later, or widen
              your age range or distance.
            </Text>
            <Pressable style={styles.secondaryButton} onPress={() => router.push("/dating-preferences")}>
              <Text style={styles.secondaryButtonText}>Edit preferences</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Modal visible={match !== null} transparent animationType="fade" onRequestClose={() => setMatch(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.matchTitle}>It's a match!</Text>
            {match?.photo && <Image source={{ uri: mediaUrl(match.photo) }} style={styles.matchPhoto} />}
            <Text style={styles.body}>
              You and {match?.displayName} both liked each other. Say hi and plan your first run
              together.
            </Text>
            <Pressable style={styles.primaryButton} onPress={openMatchChat}>
              <Text style={styles.primaryButtonText}>Send a message</Text>
            </Pressable>
            <Pressable style={styles.textButton} onPress={() => setMatch(null)}>
              <Text style={styles.textButtonText}>Keep discovering</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  centered: { alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, paddingTop: 48, paddingBottom: 40 },
  devBanner: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    alignSelf: "center",
    maxWidth: 420,
    width: "100%",
  },
  devBannerTitle: { color: "#fbbf24", fontWeight: "700", fontSize: 14, marginBottom: 4 },
  devBannerText: { color: "#fde68a", fontSize: 13, lineHeight: 19 },
  message: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", alignSelf: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#ffffff", marginBottom: 10 },
  body: { fontSize: 15, lineHeight: 22, color: "#cbd5e1", marginBottom: 24 },
  error: { color: "#f87171", fontSize: 14, marginBottom: 16, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "center", gap: 32, marginTop: 20 },
  actionButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  passButton: { borderColor: "#64748b", backgroundColor: "#1e293b" },
  likeButton: { borderColor: "#4ecdc4", backgroundColor: "rgba(78, 205, 196, 0.15)" },
  passIcon: { color: "#cbd5e1", fontSize: 26 },
  likeIcon: { color: "#4ecdc4", fontSize: 30 },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
  textButton: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  textButtonText: { color: "#94a3b8", fontSize: 15 },
  secondaryButton: {
    borderColor: "#4ecdc4",
    borderWidth: 1,
    paddingVertical: 13,
    borderRadius: 999,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#4ecdc4", fontSize: 16, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modal: {
    backgroundColor: "#1e293b",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    alignItems: "stretch",
  },
  matchTitle: { fontSize: 30, fontWeight: "800", color: "#4ecdc4", textAlign: "center", marginBottom: 16 },
  matchPhoto: { width: 120, height: 150, borderRadius: 16, alignSelf: "center", marginBottom: 16 },
});
