import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  AppState,
} from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getMe, getMessages, markRead, mediaUrl, sendMessage } from "../../../lib/api";
import { formatClock } from "../../../lib/format";
import type { Message, RunDate } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { SafetySheet } from "../../../components/SafetySheet";
import { RunDateCard } from "../../../components/RunDateCard";
import { SuggestRunSheet } from "../../../components/SuggestRunSheet";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const PAGE_SIZE = 30; // matches the API's default page
const OFFLINE_POLL_MS = 5_000;
const MAX_LENGTH = 1000;

// Adds messages, skipping any already shown (the sender also receives their own message live)
function merge(current: Message[], incoming: Message[]): Message[] {
  const seen = new Set(current.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  if (added.length === 0) return current;
  return [...current, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export default function Chat() {
  const router = useRouter();
  const { matchId, userId, name, photo } = useLocalSearchParams<{
    matchId: string;
    userId?: string;
    name?: string;
    photo?: string;
  }>();
  const { token, connected, subscribe, refreshUnread } = useChat();
  const [myId, setMyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  // Latest state of each run, which changes after its card was first sent
  const [runs, setRuns] = useState<Record<string, RunDate>>({});
  const [error, setError] = useState<string | null>(null);
  // Newest message we have, for catching up after a reconnect
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    lastId.current = messages && messages.length ? messages[messages.length - 1].id : null;
  }, [messages]);

  const handleError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) {
      setEnded(true); // unmatched, or never ours
      return;
    }
    setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
  }, []);

  const read = useCallback(() => {
    if (!token || AppState.currentState !== "active") return;
    markRead(token, matchId)
      .then(refreshUnread)
      .catch(() => {});
  }, [token, matchId, refreshUnread]);

  const catchUp = useCallback(async () => {
    if (!token) return;
    try {
      const newer = lastId.current
        ? await getMessages(token, matchId, { after: lastId.current })
        : await getMessages(token, matchId);
      if (newer.length) {
        setMessages((current) => merge(current ?? [], newer));
        read();
      }
    } catch (e) {
      handleError(e);
    }
  }, [token, matchId, read, handleError]);

  // First load
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [me, page] = await Promise.all([getMe(token), getMessages(token, matchId)]);
        setMyId(me.id);
        setMessages(page);
        setHasOlder(page.length === PAGE_SIZE);
        read();
      } catch (e) {
        handleError(e);
        setMessages([]);
      }
    })();
  }, [token, matchId, read, handleError]);

  // Live events for this conversation
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "message" && event.message.matchId === matchId) {
          setMessages((current) => merge(current ?? [], [event.message]));
          if (event.message.senderId !== myId) read();
        } else if (event.type === "read" && event.matchId === matchId) {
          setMessages((current) =>
            current?.map((m) => (m.senderId === myId && !m.readAt ? { ...m, readAt: event.readAt } : m)) ?? null
          );
        } else if (event.type === "run_date" && event.runDate.matchId === matchId) {
          setRuns((current) => ({ ...current, [event.runDate.id]: event.runDate }));
        } else if (event.type === "match_ended" && event.matchId === matchId) {
          setEnded(true);
        } else if (event.type === "ready") {
          catchUp(); // reconnected: fetch anything missed
        }
      }),
    [subscribe, matchId, myId, read, catchUp]
  );

  // No live connection: check for new messages every few seconds instead
  useEffect(() => {
    if (connected || ended) return;
    const id = setInterval(catchUp, OFFLINE_POLL_MS);
    return () => clearInterval(id);
  }, [connected, ended, catchUp]);

  const loadOlder = async () => {
    if (!token || !messages?.length || !hasOlder || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const older = await getMessages(token, matchId, { before: messages[0].id });
      setMessages((current) => merge(current ?? [], older));
      setHasOlder(older.length === PAGE_SIZE);
    } catch (e) {
      handleError(e);
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!token || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await sendMessage(token, matchId, body);
      setMessages((current) => merge(current ?? [], [message]));
      setDraft("");
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

  // Newest first for the inverted list (it starts scrolled to the bottom)
  const newestFirst = messages ? [...messages].reverse() : [];
  const mine = messages?.filter((m) => m.senderId === myId && m.kind === "text") ?? [];
  const lastMineId = mine.length ? mine[mine.length - 1].id : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color="#e2e8f0" />
        </Pressable>
        {photo ? (
          <Image source={{ uri: mediaUrl(photo) }} style={styles.headerPhoto} />
        ) : (
          <View style={[styles.headerPhoto, styles.headerPhotoEmpty]} />
        )}
        <Text style={styles.headerName} numberOfLines={1}>
          {name ?? "Chat"}
        </Text>
        {!ended && userId && (
          <Pressable
            onPress={() => setSafetyOpen(true)}
            style={styles.headerButton}
            accessibilityLabel="Report, block or unmatch"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="#94a3b8" />
          </Pressable>
        )}
      </View>

      {messages === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#4ecdc4" />
        </View>
      ) : (
        <FlatList
          inverted
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={newestFirst}
          keyExtractor={(m) => m.id}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingOlder ? <ActivityIndicator color="#4ecdc4" style={styles.olderSpinner} /> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>
                You matched with {name ?? "this runner"}! Say hi, or tap the runner to suggest a run together.
              </Text>
            </View>
          }
          renderItem={({ item: m }) => {
            if (m.kind === "run_date" && m.runDate) {
              return (
                <RunDateCard
                  run={runs[m.runDate.id] ?? m.runDate}
                  myId={myId}
                  token={token}
                  otherName={name ?? "They"}
                  onUpdated={(run) => setRuns((current) => ({ ...current, [run.id]: run }))}
                />
              );
            }
            if (m.kind === "system") {
              const who = m.senderId === myId ? "You" : name ?? "They";
              return (
                <Text style={styles.systemNote}>
                  {who}: {m.body} · {formatClock(m.createdAt)}
                </Text>
              );
            }
            const isMine = m.senderId === myId;
            return (
              <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
                <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{m.body}</Text>
                  <Text style={[styles.time, isMine && styles.timeMine]}>{formatClock(m.createdAt)}</Text>
                </View>
                {isMine && m.id === lastMineId && m.readAt && <Text style={styles.seen}>Seen</Text>}
              </View>
            );
          }}
        />
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {ended ? (
        <View style={styles.endedBar}>
          <Text style={styles.endedText}>This match has ended. You can no longer message each other.</Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <Pressable
            style={styles.runButton}
            onPress={() => setSuggestOpen(true)}
            accessibilityLabel="Suggest a run"
          >
            <Ionicons name="walk" size={22} color="#4ecdc4" />
          </Pressable>
          <TextInput
            style={styles.input}
            placeholder="Message"
            placeholderTextColor="#64748b"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={MAX_LENGTH}
            onSubmitEditing={Platform.OS === "web" ? send : undefined}
            blurOnSubmit={Platform.OS === "web"}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}
            onPress={send}
            disabled={!draft.trim() || sending}
            accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={22} color="#0f172a" />
          </Pressable>
        </View>
      )}

      <SuggestRunSheet
        visible={suggestOpen}
        token={token}
        matchId={matchId}
        name={name ?? "your match"}
        onClose={() => setSuggestOpen(false)}
        onSent={(card) => {
          setMessages((current) => merge(current ?? [], [card]));
          setSuggestOpen(false);
        }}
      />

      {userId && (
        <SafetySheet
          visible={safetyOpen}
          token={token}
          person={{ id: userId, name: name ?? "this runner" }}
          matchId={matchId}
          onClose={() => setSafetyOpen(false)}
          onDone={() => {
            setSafetyOpen(false);
            refreshUnread();
            router.back();
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 44,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  headerButton: { padding: 6 },
  headerPhoto: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#334155" },
  headerPhotoEmpty: { borderWidth: 1, borderColor: "#475569" },
  headerName: { flex: 1, color: "#ffffff", fontSize: 17, fontWeight: "700" },
  list: { flex: 1 },
  listContent: { padding: 12, maxWidth: 720, width: "100%", alignSelf: "center" },
  olderSpinner: { marginVertical: 12 },
  emptyChat: { padding: 24, transform: [{ scaleY: -1 }] }, // counter the inverted list
  emptyChatText: { color: "#94a3b8", fontSize: 15, lineHeight: 22, textAlign: "center" },
  bubbleRow: { marginVertical: 3, alignItems: "flex-start" },
  bubbleRowMine: { alignItems: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: "#1e293b", borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: "#4ecdc4", borderBottomRightRadius: 4 },
  bubbleText: { color: "#e2e8f0", fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: "#0f172a" },
  time: { color: "#64748b", fontSize: 11, marginTop: 2, alignSelf: "flex-end" },
  timeMine: { color: "#134e4a" },
  seen: { color: "#64748b", fontSize: 11, marginTop: 2, marginRight: 4 },
  error: { color: "#f87171", fontSize: 13, textAlign: "center", paddingHorizontal: 16, paddingBottom: 6 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: "#1e293b",
    color: "#ffffff",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  runButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#4ecdc4",
    alignItems: "center",
    justifyContent: "center",
  },
  systemNote: { color: "#64748b", fontSize: 12, textAlign: "center", marginVertical: 6 },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4ecdc4",
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  endedBar: { padding: 16, borderTopWidth: 1, borderTopColor: "#1e293b" },
  endedText: { color: "#94a3b8", fontSize: 14, textAlign: "center" },
});
