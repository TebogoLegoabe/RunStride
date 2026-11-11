import { View, Pressable, StyleSheet, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, AppState } from "react-native";
import { Text, TextInput } from "./ui/Text";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import {
  ApiError,
  getMe,
  getMessages,
  markRead,
  reactToMessage,
  sendChatPhoto,
  sendMessage,
  sendVoiceNote,
} from "../lib/api";
import { formatClock } from "../lib/format";
import type { Message, Reaction, RunDate } from "../lib/types";
import { MessageBubble, quoteLabel } from "./chat/MessageBubble";
import { MessageMenu } from "./chat/MessageMenu";
import { PhotoComposer, PhotoViewer } from "./chat/PhotoSheets";
import { useVoiceRecorder } from "../lib/recorder";
import { useChat } from "./ChatProvider";
import { SafetySheet } from "./SafetySheet";
import { RunDateCard } from "./RunDateCard";
import { SuggestRunSheet } from "./SuggestRunSheet";
import { colors, fonts, gradient } from "../lib/theme";
import { UserPhoto } from "./ui/UserPhoto";
import { useBottomPadding, useTopPadding } from "../lib/responsive";
import { dismissTip, tipDismissed } from "../lib/tips";
import { EmojiPanel, EmojiToggle } from "./ui/EmojiPanel";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const PAGE_SIZE = 30; // matches the API's default page
const OFFLINE_POLL_MS = 5_000;
const MAX_LENGTH = 1000;

// Messages and the day headings between them, newest first for the inverted list. Each message
// knows whether it starts or ends a run from the same person, so a run reads as one block.
type Row =
  | { type: "day"; key: string; label: string }
  | { type: "message"; key: string; m: Message; first: boolean; last: boolean };

const GROUP_GAP_MS = 5 * 60 * 1000;
const dayKey = (iso: string) => new Date(iso).toDateString();

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

const bubbly = (m: Message) => m.kind === "text" || m.kind === "image" || m.kind === "voice";
const joined = (a: Message | undefined, b: Message | undefined) =>
  !!a &&
  !!b &&
  bubbly(a) &&
  bubbly(b) &&
  a.senderId === b.senderId &&
  dayKey(a.createdAt) === dayKey(b.createdAt) &&
  Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_GAP_MS;

function toRows(messages: Message[]): Row[] {
  const rows: Row[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    rows.push({ type: "message", key: m.id, m, first: !joined(messages[i - 1], m), last: !joined(m, messages[i + 1]) });
    const older = messages[i - 1];
    if (!older || dayKey(older.createdAt) !== dayKey(m.createdAt)) {
      rows.push({ type: "day", key: `day-${dayKey(m.createdAt)}`, label: dayLabel(m.createdAt) });
    }
  }
  return rows;
}

const recordClock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Adds messages, skipping any already shown (the sender also receives their own message live)
function merge(current: Message[], incoming: Message[]): Message[] {
  const seen = new Set(current.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  if (added.length === 0) return current;
  return [...current, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

type Props = {
  matchId: string;
  userId?: string;
  name?: string;
  photo?: string;
  verified?: boolean; // the other person passed ID verification
  // Leave the conversation: back on phones, close the pane in the desktop split view
  onClose: () => void;
  // Inside the Matches split view: no back button, no notch padding
  embedded?: boolean;
};

// One conversation. Used full screen on phones and as the right-hand pane of Matches on wide screens.
export function ChatView({ matchId, userId, name, photo, verified = false, onClose, embedded = false }: Props) {
  const topPadding = useTopPadding(0);
  const bottomPadding = useBottomPadding(16, true);
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
  const [showTip, setShowTip] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Latest state of each run, which changes after its card was first sent
  const [runs, setRuns] = useState<Record<string, RunDate>>({});
  const [error, setError] = useState<string | null>(null);
  // Newest message we have, for catching up after a reconnect
  const lastId = useRef<string | null>(null);
  const list = useRef<FlatList<Row>>(null);
  // Replying to (swipe right, or Reply in the long-press menu)
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // A picked photo waiting for its caption, and a photo open full screen
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const recorder = useVoiceRecorder();
  const [recordMs, setRecordMs] = useState(0);
  const input = useRef<React.ElementRef<typeof TextInput>>(null);
  const otherName = name ?? "They";

  useEffect(() => {
    if (!recorder.recording) return;
    setRecordMs(0);
    const id = setInterval(() => setRecordMs(Date.now() - recorder.startedAt()), 250);
    return () => clearInterval(id);
  }, [recorder.recording, recorder]);

  useEffect(() => {
    let live = true;
    tipDismissed(`match.${matchId}`).then((done) => live && setShowTip(!done));
    return () => {
      live = false;
    };
  }, [matchId]);

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
        } else if (event.type === "reaction" && event.matchId === matchId) {
          setReactions(event.messageId, event.reactions);
        } else if (event.type === "run_date" && event.runDate.matchId === matchId) {
          setRuns((current) => ({ ...current, [event.runDate.id]: event.runDate }));
        } else if (event.type === "match_ended" && event.matchId === matchId) {
          setEnded(true);
        } else if (event.type === "ready") {
          catchUp(); // reconnected: fetch anything missed
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function setReactions(messageId: string, reactions: Reaction[]) {
    setMessages((current) => current?.map((m) => (m.id === messageId ? { ...m, reactions } : m)) ?? null);
  }

  const added = (message: Message) => {
    setMessages((current) => merge(current ?? [], [message]));
    setReplyTo(null);
  };

  const send = async () => {
    const body = draft.trim();
    if (!token || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      added(await sendMessage(token, matchId, body, replyTo?.id));
      setDraft("");
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

  // Shows straight away; goes back if the server says no
  const react = async (m: Message, emoji: string | null) => {
    if (!token || !myId) return;
    const before = m.reactions ?? [];
    const others = before.filter((r) => r.userId !== myId);
    setReactions(m.id, emoji ? [...others, { userId: myId, emoji }] : others);
    try {
      setReactions(m.id, await reactToMessage(token, matchId, m.id, emoji));
    } catch (e) {
      setReactions(m.id, before);
      handleError(e);
    }
  };

  const startReply = useCallback((m: Message) => {
    setReplyTo(m);
    setTimeout(() => input.current?.focus(), 50);
  }, []);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!result.canceled) {
      setPhotoError(null);
      setPhotoUri(result.assets[0].uri);
    }
  };

  const sendPhoto = async (caption: string) => {
    if (!token || !photoUri) return;
    setSending(true);
    setPhotoError(null);
    try {
      added(await sendChatPhoto(token, matchId, photoUri, caption, replyTo?.id));
      setPhotoUri(null);
    } catch (e) {
      setPhotoError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    setError(null);
    const problem = await recorder.start();
    if (problem === "denied") setError("RunStride needs the microphone to record. You can allow it in your settings.");
    else if (problem) setError("Couldn't start recording on this device.");
  };

  const finishRecording = async () => {
    if (!token) return;
    const recording = await recorder.stop();
    if (!recording) return;
    if (recording.durationMs < 800) {
      setError("Hold on a moment longer to record a voice message.");
      return;
    }
    setSending(true);
    try {
      added(await sendVoiceNote(token, matchId, recording.file, recording.name, recording.durationMs, replyTo?.id));
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

  const rows = useMemo(() => (messages ? toRows(messages) : []), [messages]);

  // Tapping a quote scrolls to the message it answers, and lights it up for a moment
  const jumpTo = useCallback(
    (id: string) => {
      const index = rows.findIndex((r) => r.type === "message" && r.m.id === id);
      if (index < 0) return;
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setHighlight(id);
      setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1600);
    },
    [rows]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "web" ? undefined : "padding"}
    >
      <View style={[styles.header, { paddingTop: embedded ? 14 : topPadding }, embedded && styles.headerEmbedded]}>
        {!embedded && (
          <Pressable onPress={onClose} style={styles.headerButton} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={colors.textBright} />
          </Pressable>
        )}
        <UserPhoto photo={photo} style={styles.headerPhoto} />
        <Text style={styles.headerName} numberOfLines={1}>
          {name ?? "Chat"}
        </Text>
        {!ended && userId && (
          <Pressable
            onPress={() => setSafetyOpen(true)}
            style={styles.headerButton}
            accessibilityLabel="Report, block or unmatch"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {messages === null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
        {showTip && (
          <View style={styles.tip}>
            <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
            <View style={styles.tipBody}>
              <Text style={styles.tipTitle}>Before you meet</Text>
              <Text style={styles.tipText}>
                {verified
                  ? `${name ?? "They"} is ID-verified. `
                  : `${name ?? "They"} hasn't verified their ID, so take a little extra care. `}
                Chat here for a while first. Meet somewhere open and busy, ideally at a race or with a group,
                and share your run with a friend.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setShowTip(false);
                dismissTip(`match.${matchId}`);
              }}
              accessibilityLabel="Dismiss tip"
              hitSlop={10}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
        <View style={styles.list}>
          <LinearGradient colors={gradient.glow} style={styles.glow} pointerEvents="none" />
          <FlatList
            ref={list}
            inverted
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={rows}
            keyExtractor={(r) => r.key}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.3}
            onScrollToIndexFailed={({ index }) => setTimeout(() => list.current?.scrollToIndex({ index, animated: true }), 250)}
            ListFooterComponent={
              loadingOlder ? <ActivityIndicator color={colors.primary} style={styles.olderSpinner} /> : null
            }
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Text style={styles.emptyChatText}>
                  You matched with {name ?? "this runner"}! Say hi, send a voice note, or tap the runner to suggest a run together.
                </Text>
              </View>
            }
            renderItem={({ item: row }) => {
              if (row.type === "day") {
                return (
                  <View style={styles.day}>
                    <Text style={styles.dayText}>{row.label}</Text>
                  </View>
                );
              }
              const m = row.m;
              if (m.kind === "run_date" && m.runDate) {
                return (
                  <RunDateCard
                    run={runs[m.runDate.id] ?? m.runDate}
                    myId={myId}
                    token={token}
                    otherName={otherName}
                    onUpdated={(run) => setRuns((current) => ({ ...current, [run.id]: run }))}
                  />
                );
              }
              if (m.kind === "system") {
                const who = m.senderId === myId ? "You" : otherName;
                return (
                  <Text style={styles.systemNote}>
                    {who}: {m.body} · {formatClock(m.createdAt)}
                  </Text>
                );
              }
              return (
                <MessageBubble
                  m={m}
                  mine={m.senderId === myId}
                  myId={myId}
                  otherName={otherName}
                  first={row.first}
                  last={row.last}
                  highlighted={highlight === m.id}
                  onReply={startReply}
                  onMenu={setMenuFor}
                  onOpenPhoto={setViewing}
                  onJumpTo={jumpTo}
                />
              );
            }}
          />
        </View>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {ended ? (
        <View style={[styles.endedBar, { paddingBottom: bottomPadding }]}>
          <Text style={styles.endedText}>This match has ended. You can no longer message each other.</Text>
        </View>
      ) : (
        <>
        {emojiOpen && (
          <View style={styles.emojiWrap}>
            <EmojiPanel
              onClose={() => setEmojiOpen(false)}
              onPick={(emoji) => setDraft((d) => (d + emoji).slice(0, MAX_LENGTH))}
            />
          </View>
        )}
        {replyTo && (
          <View style={styles.replyBar}>
            <View style={styles.replyAccent} />
            <View style={styles.replyText}>
              <Text style={styles.replyWho} numberOfLines={1}>
                Replying to {replyTo.senderId === myId ? "yourself" : otherName}
              </Text>
              <Text style={styles.replyWhat} numberOfLines={1}>
                {quoteLabel(replyTo, myId, otherName).what}
              </Text>
            </View>
            <Pressable onPress={() => setReplyTo(null)} accessibilityLabel="Cancel reply" hitSlop={10}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
        <View style={[styles.composer, { paddingBottom: embedded ? 16 : bottomPadding }]}>
          {recorder.recording ? (
            <>
              <Pressable style={styles.iconButton} onPress={() => recorder.cancel()} accessibilityLabel="Delete recording">
                <Ionicons name="trash-outline" size={22} color={colors.dangerText} />
              </Pressable>
              <View style={styles.recordingBar}>
                <View style={styles.recDot} />
                <Text style={styles.recTime}>{recordClock(recordMs)}</Text>
                <Text style={styles.recHint} numberOfLines={1}>
                  Recording. Tap send when done
                </Text>
              </View>
              <Pressable style={styles.sendButton} onPress={finishRecording} accessibilityLabel="Send voice message">
                <Ionicons name="send" size={19} color={colors.onPrimary} />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={styles.runButton} onPress={() => setSuggestOpen(true)} accessibilityLabel="Suggest a run">
                <Ionicons name="walk" size={22} color={colors.primary} />
              </Pressable>
              <View style={styles.inputWrap}>
                <EmojiToggle open={emojiOpen} onPress={() => setEmojiOpen((o) => !o)} />
                <TextInput
                  ref={input}
                  style={styles.input}
                  placeholder="Message"
                  placeholderTextColor={colors.textFaint}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={MAX_LENGTH}
                  onSubmitEditing={Platform.OS === "web" ? send : undefined}
                  blurOnSubmit={Platform.OS === "web"}
                />
                <Pressable onPress={pickPhoto} style={styles.attach} accessibilityLabel="Send a photo" hitSlop={6}>
                  <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                </Pressable>
              </View>
              {draft.trim() ? (
                <Pressable
                  style={[styles.sendButton, sending && styles.sendDisabled]}
                  onPress={send}
                  disabled={sending}
                  accessibilityLabel="Send"
                >
                  <Ionicons name="send" size={19} color={colors.onPrimary} />
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.sendButton, sending && styles.sendDisabled]}
                  onPress={startRecording}
                  disabled={sending}
                  accessibilityLabel="Record a voice message"
                >
                  {sending ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name="mic" size={21} color={colors.onPrimary} />}
                </Pressable>
              )}
            </>
          )}
        </View>
        </>
      )}

      <MessageMenu
        message={menuFor}
        myId={myId}
        otherName={otherName}
        onClose={() => setMenuFor(null)}
        onReact={react}
        onReply={startReply}
      />
      <PhotoComposer uri={photoUri} sending={sending} error={photoError} onSend={sendPhoto} onCancel={() => setPhotoUri(null)} />
      <PhotoViewer url={viewing} onClose={() => setViewing(null)} />

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
            onClose();
          }}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  headerEmbedded: { paddingHorizontal: 16 },
  headerButton: { padding: 6 },
  headerPhoto: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border },
  headerPhotoEmpty: { borderWidth: 1, borderColor: colors.borderStrong },
  headerName: { flex: 1, color: colors.heading, fontSize: 17, fontWeight: "700" },
  list: { flex: 1 },
  listContent: { padding: 12, maxWidth: 720, width: "100%", alignSelf: "center" },
  olderSpinner: { marginVertical: 12 },
  tip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.primaryTintSoft,
  },
  tipBody: { flex: 1 },
  tipTitle: { color: colors.heading, fontSize: 13, fontWeight: "700", marginBottom: 2 },
  tipText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  emptyChat: { padding: 24, transform: [{ scaleY: -1 }] }, // counter the inverted list
  emptyChatText: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: "center" },
  error: { color: colors.dangerText, fontSize: 13, textAlign: "center", paddingHorizontal: 16, paddingBottom: 6 },
  emojiWrap: { paddingHorizontal: 10, width: "100%", maxWidth: 760, alignSelf: "center" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 4,
    paddingRight: 8,
    minHeight: 44,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    color: colors.heading,
    paddingHorizontal: 6,
    paddingVertical: 11,
    fontSize: 15,
  },
  attach: { paddingVertical: 10, paddingHorizontal: 2 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  recordingBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 44,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  recTime: { color: colors.heading, fontFamily: fonts.bold, fontSize: 15 },
  recHint: { flex: 1, color: colors.textFaint, fontSize: 13 },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "100%",
    maxWidth: 740,
    alignSelf: "center",
    marginTop: 6,
    paddingVertical: 8,
    paddingRight: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  replyAccent: { width: 4, alignSelf: "stretch", backgroundColor: colors.primary },
  replyText: { flex: 1 },
  replyWho: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  replyWhat: { color: colors.textMuted, fontSize: 13 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 220 },
  day: { alignItems: "center", marginVertical: 10 },
  dayText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.semibold,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  runButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  systemNote: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginVertical: 6 },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  endedBar: { padding: 16, borderTopWidth: 1, borderTopColor: colors.surface },
  endedText: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
});
