import { View, StyleSheet, Pressable, FlatList, Image } from "react-native";
import { Text } from "../../../components/ui/Text";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, answerChatRequest, getChatRequests, getMatches, getMe, mediaUrl } from "../../../lib/api";
import { formatWhen } from "../../../lib/format";
import type { ChatRequest, MatchSummary, RealtimeEvent } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import Animated, { FadeInDown } from "react-native-reanimated";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SkeletonRow } from "../../../components/ui/Skeleton";
import { ChatView } from "../../../components/ChatView";
import { hoverable, useBreakpoint, useTopPadding } from "../../../lib/responsive";
import { colors } from "../../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const OFFLINE_POLL_MS = 15_000;
// Events that change this list (race group chat messages don't)
const MATCH_LIST_EVENTS = new Set<RealtimeEvent["type"]>([
  "ready",
  "message",
  "read",
  "match_ended",
  "chat_request",
  "chat_request_accepted",
]);

export default function Matches() {
  const router = useRouter();
  const { token, connected, subscribe, refreshUnread } = useChat();
  const [myId, setMyId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [requests, setRequests] = useState<ChatRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Wide screens show the list and the open conversation side by side
  const { isWide } = useBreakpoint();
  const topPadding = useTopPadding();
  const [open, setOpen] = useState<{ matchId: string; userId: string; name: string; photo: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [m, r] = await Promise.all([getMatches(token), getChatRequests(token)]);
      setMatches(m);
      setRequests(r);
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
  useEffect(
    () => subscribe((e) => MATCH_LIST_EVENTS.has(e.type) && load()),
    [subscribe, load]
  );
  useEffect(() => {
    if (connected) return;
    const id = setInterval(load, OFFLINE_POLL_MS);
    return () => clearInterval(id);
  }, [connected, load]);

  const answer = async (request: ChatRequest, choice: "accept" | "decline") => {
    if (!token) return;
    try {
      const result = await answerChatRequest(token, request.id, choice);
      refreshUnread();
      if (choice === "accept" && result.matchId && isWide) {
        setOpen({
          matchId: result.matchId,
          userId: request.other.id,
          name: request.other.displayName,
          photo: request.other.photo ?? "",
        });
      } else if (choice === "accept" && result.matchId) {
        router.push({
          pathname: "/chat/[matchId]",
          params: {
            matchId: result.matchId,
            userId: request.other.id,
            name: request.other.displayName,
            photo: request.other.photo ?? "",
          },
        });
      }
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const incoming = requests.filter((r) => r.incoming);
  const outgoing = requests.filter((r) => !r.incoming);

  const requestsHeader =
    incoming.length + outgoing.length > 0 ? (
      <View style={styles.requests}>
        {incoming.length > 0 && <Text style={styles.sectionTitle}>Chat requests</Text>}
        {incoming.map((r) => (
          <View key={r.id} style={styles.requestCard}>
            <View style={styles.requestTop}>
              {r.other.photo ? (
                <Image source={{ uri: mediaUrl(r.other.photo) }} style={styles.requestAvatar} />
              ) : (
                <View style={[styles.requestAvatar, styles.avatarEmpty]} />
              )}
              <View style={styles.rowText}>
                <Text style={styles.name}>{r.other.displayName}</Text>
                <Text style={styles.requestVia}>
                  {r.listingKind
                    ? `About your entry ${r.listingKind === "offering" ? "for sale" : "request"} · ${r.raceName}`
                    : `Going to ${r.raceName}`}
                </Text>
              </View>
            </View>
            {r.note && <Text style={styles.requestNote}>“{r.note}”</Text>}
            <View style={styles.requestActions}>
              <Pressable style={styles.declineButton} onPress={() => answer(r, "decline")}>
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
              <Pressable style={styles.acceptButton} onPress={() => answer(r, "accept")}>
                <Text style={styles.acceptText}>Accept</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {outgoing.length > 0 && (
          <Text style={styles.waiting}>
            Waiting for {outgoing.map((r) => r.other.displayName).join(", ")} to accept your request
            {outgoing.length > 1 ? "s" : ""}.
          </Text>
        )}
      </View>
    ) : null;

  const openChat = (m: MatchSummary) => {
    const params = { matchId: m.id, userId: m.userId, name: m.displayName, photo: m.photo ?? "" };
    if (isWide) setOpen(params);
    else router.push({ pathname: "/chat/[matchId]", params });
  };

  // The open conversation disappears if the match ends or the list no longer has it
  useEffect(() => {
    if (open && matches && !matches.some((m) => m.id === open.matchId)) setOpen(null);
  }, [open, matches]);

  if (matches === null) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPadding }]}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.skeletons}>
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </View>
        )}
      </View>
    );
  }

  const list = (
    <View style={[styles.container, { paddingTop: topPadding }, isWide && styles.listPane]}>
      <Text style={styles.heading}>Matches</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={requestsHeader}
        contentContainerStyle={matches.length === 0 ? styles.emptyWrap : undefined}
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles"
            title="No matches yet"
            body="When you and another runner like each other, or someone accepts your chat request at a race, you can chat here."
            action={{ title: "Discover runners", icon: "compass-outline", onPress: () => router.navigate("/discover") }}
          />
        }
        renderItem={({ item: m, index }) => {
          const last = m.lastMessage;
          const preview = last
            ? `${last.senderId === myId ? "You: " : ""}${last.body}`
            : m.kind === "race"
              ? "Connected! Say hi 👋"
              : "New match! Say hi 👋";
          const unread = m.unreadCount > 0;
          const selected = isWide && open?.matchId === m.id;
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(350)}>
            <Pressable
              style={hoverable(({ hovered, pressed }) => [
                styles.row,
                (hovered || pressed) && styles.rowHover,
                selected && styles.rowSelected,
              ])}
              onPress={() => openChat(m)}
            >
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
                {m.originRaceName && <Text style={styles.origin}>Met at {m.originRaceName}</Text>}
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
            </Animated.View>
          );
        }}
      />
    </View>
  );

  if (!isWide) return list;
  return (
    <View style={styles.split}>
      {list}
      <View style={styles.chatPane}>
        {open ? (
          <ChatView key={open.matchId} {...open} embedded onClose={() => setOpen(null)} />
        ) : (
          <EmptyState
            icon="chatbubble-ellipses"
            title="Pick a conversation"
            body={matches.length ? "Choose a match on the left to start chatting." : "Your conversations will show up here."}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  split: { flex: 1, flexDirection: "row", backgroundColor: colors.bg },
  listPane: { flexGrow: 0, flexShrink: 0, flexBasis: 380, width: 380, borderRightWidth: 1, borderRightColor: colors.surface },
  chatPane: { flex: 1, justifyContent: "center" },
  skeletons: { width: "100%", maxWidth: 640, paddingHorizontal: 16 },
  centered: { alignItems: "center", justifyContent: "center" },
  heading: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.heading,
    paddingHorizontal: 16,
    marginBottom: 12,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
  },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 12, textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
    borderRadius: 14,
  },
  rowHover: { backgroundColor: colors.surface },
  rowSelected: { backgroundColor: colors.surface },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.border },
  avatarEmpty: { borderWidth: 1, borderColor: colors.borderStrong },
  rowText: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  name: { color: colors.heading, fontSize: 16, flexShrink: 1 },
  bold: { fontWeight: "700" },
  when: { color: colors.textFaint, fontSize: 12 },
  preview: { color: colors.textMuted, fontSize: 14, flex: 1 },
  previewNew: { color: colors.primary },
  previewUnread: { color: colors.textBright, fontWeight: "600" },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  emptyWrap: { flexGrow: 1 },
  origin: { color: colors.pink, fontSize: 12, marginTop: 1 },
  requests: { paddingHorizontal: 16, paddingBottom: 8, maxWidth: 640, width: "100%", alignSelf: "center" },
  sectionTitle: { color: colors.textMuted, fontSize: 13, fontWeight: "700", marginBottom: 8 },
  requestCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 10 },
  requestTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  requestAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.border },
  requestVia: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  requestNote: { color: colors.text, fontSize: 14, fontStyle: "italic", marginTop: 8 },
  requestActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  declineButton: {
    flex: 1,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 9,
    alignItems: "center",
  },
  declineText: { color: colors.text, fontSize: 14 },
  acceptButton: { flex: 1, backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 9, alignItems: "center" },
  acceptText: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
  waiting: { color: colors.textFaint, fontSize: 12, marginBottom: 8 },
  empty: { flex: 1, justifyContent: "center", padding: 24, maxWidth: 420, width: "100%", alignSelf: "center" },
});
