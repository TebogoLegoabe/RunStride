import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, Image } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, getMatches, getMe, mediaUrl } from "../../../lib/api";
import { formatWhen } from "../../../lib/format";
import type { MatchSummary } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const OFFLINE_POLL_MS = 15_000;

export default function Matches() {
  const router = useRouter();
  const { token, connected, subscribe } = useChat();
  const [myId, setMyId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setMatches(await getMatches(token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token]);

  useEffect(() => {
    if (token) getMe(token).then((me) => setMyId(me.id)).catch(() => {});
  }, [token]);

  // Refresh whenever this tab is shown, e.g. coming back from a chat
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live updates while connected; slow polling as a fallback when not
  useEffect(() => subscribe((e) => e.type !== "pong" && load()), [subscribe, load]);
  useEffect(() => {
    if (connected) return;
    const id = setInterval(load, OFFLINE_POLL_MS);
    return () => clearInterval(id);
  }, [connected, load]);

  const openChat = (m: MatchSummary) =>
    router.push({
      pathname: "/chat/[matchId]",
      params: { matchId: m.id, name: m.displayName, photo: m.photo ?? "" },
    });

  if (matches === null) {
    return (
      <View style={[styles.container, styles.centered]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color="#4ecdc4" />}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Matches</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        contentContainerStyle={matches.length === 0 ? styles.emptyWrap : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No matches yet</Text>
            <Text style={styles.emptyBody}>
              When you and another runner both like each other, you'll be able to chat here.
            </Text>
            <Pressable style={styles.secondaryButton} onPress={() => router.navigate("/discover")}>
              <Text style={styles.secondaryButtonText}>Discover runners</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item: m }) => {
          const last = m.lastMessage;
          const preview = last
            ? `${last.senderId === myId ? "You: " : ""}${last.body}`
            : "New match! Say hi 👋";
          const unread = m.unreadCount > 0;
          return (
            <Pressable style={styles.row} onPress={() => openChat(m)}>
              {m.photo ? (
                <Image source={{ uri: mediaUrl(m.photo) }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]} />
              )}
              <View style={styles.rowText}>
                <View style={styles.rowTop}>
                  <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>
                    {m.displayName}
                  </Text>
                  <Text style={styles.when}>{formatWhen(last?.createdAt ?? m.matchedAt)}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <Text
                    style={[styles.preview, !last && styles.previewNew, unread && styles.previewUnread]}
                    numberOfLines={1}
                  >
                    {preview}
                  </Text>
                  {unread && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{m.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", paddingTop: 48 },
  centered: { alignItems: "center", justifyContent: "center" },
  heading: {
    fontSize: 26,
    fontWeight: "700",
    color: "#ffffff",
    paddingHorizontal: 16,
    marginBottom: 12,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  error: { color: "#f87171", fontSize: 14, marginBottom: 12, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: "#334155" },
  avatarEmpty: { borderWidth: 1, borderColor: "#475569" },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  name: { color: "#ffffff", fontSize: 16, flexShrink: 1 },
  bold: { fontWeight: "700" },
  when: { color: "#64748b", fontSize: 12 },
  preview: { color: "#94a3b8", fontSize: 14, flex: 1 },
  previewNew: { color: "#4ecdc4" },
  previewUnread: { color: "#e2e8f0", fontWeight: "600" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: "#4ecdc4",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#0f172a", fontSize: 12, fontWeight: "700" },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", alignSelf: "center" },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: "#ffffff", marginBottom: 8 },
  emptyBody: { fontSize: 15, lineHeight: 22, color: "#cbd5e1", marginBottom: 24 },
  secondaryButton: {
    borderColor: "#4ecdc4",
    borderWidth: 1,
    paddingVertical: 13,
    borderRadius: 999,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#4ecdc4", fontSize: 16, fontWeight: "600" },
});
