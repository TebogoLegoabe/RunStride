import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Image, Modal } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getRaceMessages, mediaUrl, postRaceMessage, removeRaceMessage } from "../../lib/api";
import { formatWhen } from "../../lib/format";
import type { RaceMessage } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { SafetySheet } from "../SafetySheet";
import { colors } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const PAGE_SIZE = 50;
const OFFLINE_POLL_MS = 10_000;

type Props = { raceId: string; myId: string | null; isAdmin: boolean };

function merge(current: RaceMessage[], incoming: RaceMessage[]): RaceMessage[] {
  const seen = new Set(current.map((m) => m.id));
  const added = incoming.filter((m) => !seen.has(m.id));
  if (!added.length) return current;
  return [...current, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function RaceChat({ raceId, myId, isAdmin }: Props) {
  const { token, connected, subscribe } = useChat();
  const [messages, setMessages] = useState<RaceMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RaceMessage | null>(null);
  const [reporting, setReporting] = useState<RaceMessage | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await getRaceMessages(token, raceId);
      setMessages((current) => merge(current ?? [], page));
      setHasOlder((h) => h || page.length === PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, raceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "race_message" && event.message.raceId === raceId) {
          setMessages((current) => merge(current ?? [], [event.message]));
        } else if (event.type === "race_message_removed" && event.raceId === raceId) {
          setMessages((current) => current?.filter((m) => m.id !== event.messageId) ?? null);
        } else if (event.type === "ready") {
          load(); // reconnected: catch up
        }
      }),
    [subscribe, raceId, load]
  );

  useEffect(() => {
    if (connected) return;
    const id = setInterval(load, OFFLINE_POLL_MS);
    return () => clearInterval(id);
  }, [connected, load]);

  const loadOlder = async () => {
    if (!token || !messages?.length) return;
    try {
      const older = await getRaceMessages(token, raceId, messages[0].id);
      setMessages((current) => merge(current ?? [], older));
      setHasOlder(older.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!token || !body || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await postRaceMessage(token, raceId, body);
      setMessages((current) => merge(current ?? [], [message]));
      setDraft("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setSending(false);
    }
  };

  const remove = async (message: RaceMessage) => {
    if (!token) return;
    setSelected(null);
    try {
      await removeRaceMessage(token, message.id);
      setMessages((current) => current?.filter((m) => m.id !== message.id) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  if (messages === null) {
    return error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />;
  }

  return (
    <View>
      <Text style={styles.hint}>Everyone going to this race can see this chat. Long-press a message to report it.</Text>
      {hasOlder && (
        <Pressable onPress={loadOlder} style={styles.olderButton}>
          <Text style={styles.olderText}>Load earlier messages</Text>
        </Pressable>
      )}
      {messages.length === 0 && <Text style={styles.empty}>No messages yet. Say hi to your fellow runners!</Text>}
      {messages.map((m) => {
        const mine = m.sender.id === myId;
        return (
          <Pressable
            key={m.id}
            style={[styles.row, mine && styles.rowMine]}
            onLongPress={() => setSelected(m)}
            delayLongPress={350}
          >
            {!mine &&
              (m.sender.photo ? (
                <Image source={{ uri: mediaUrl(m.sender.photo) }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]} />
              ))}
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              {!mine && <Text style={styles.name}>{m.sender.displayName}</Text>}
              <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
              <Text style={[styles.time, mine && styles.timeMine]}>{formatWhen(m.createdAt)}</Text>
            </View>
          </Pressable>
        );
      })}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Message everyone at this race"
          placeholderTextColor={colors.textFaint}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={1000}
        />
        <Pressable
          style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}
          onPress={send}
          disabled={!draft.trim() || sending}
          accessibilityLabel="Send"
        >
          <Ionicons name="arrow-up" size={20} color={colors.onPrimary} />
        </Pressable>
      </View>

      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              “{selected?.body}”
            </Text>
            {selected && selected.sender.id !== myId && (
              <Pressable
                style={styles.sheetButton}
                onPress={() => {
                  setReporting(selected);
                  setSelected(null);
                }}
              >
                <Text style={styles.sheetDanger}>Report {selected.sender.displayName}</Text>
              </Pressable>
            )}
            {selected && isAdmin && (
              <Pressable style={styles.sheetButton} onPress={() => remove(selected)}>
                <Text style={styles.sheetDanger}>Remove message (moderator)</Text>
              </Pressable>
            )}
            <Pressable style={styles.sheetButton} onPress={() => setSelected(null)}>
              <Text style={styles.sheetCancel}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {reporting && (
        <SafetySheet
          visible
          token={token}
          person={{ id: reporting.sender.id, name: reporting.sender.displayName }}
          raceId={raceId}
          onClose={() => setReporting(null)}
          onDone={() => {
            // Reporting also blocks: their messages disappear for you
            const blockedId = reporting.sender.id;
            setMessages((current) => current?.filter((m) => m.sender.id !== blockedId) ?? null);
            setReporting(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textFaint, fontSize: 12, marginBottom: 10 },
  olderButton: { alignItems: "center", paddingVertical: 8 },
  olderText: { color: colors.primary, fontSize: 13 },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: "center", marginVertical: 20 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginVertical: 4 },
  rowMine: { justifyContent: "flex-end" },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.border },
  avatarEmpty: { borderWidth: 1, borderColor: colors.borderStrong },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  name: { color: colors.pink, fontSize: 12, fontWeight: "700", marginBottom: 2 },
  body: { color: colors.textBright, fontSize: 15, lineHeight: 20 },
  bodyMine: { color: colors.onPrimary },
  time: { color: colors.textFaint, fontSize: 10, marginTop: 2, alignSelf: "flex-end" },
  timeMine: { color: colors.onPrimaryMuted },
  error: { color: colors.dangerText, fontSize: 13, textAlign: "center", marginVertical: 8 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    maxHeight: 110,
    backgroundColor: colors.surface,
    color: colors.heading,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: colors.surface, borderRadius: 18, padding: 16, maxWidth: 400, width: "100%", alignSelf: "center" },
  sheetTitle: { color: colors.textMuted, fontSize: 14, fontStyle: "italic", marginBottom: 8 },
  sheetButton: { paddingVertical: 13, alignItems: "center" },
  sheetDanger: { color: colors.dangerText, fontSize: 16, fontWeight: "600" },
  sheetCancel: { color: colors.textMuted, fontSize: 16 },
});
