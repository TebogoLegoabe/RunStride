import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Image, Modal } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, answerChatRequest, getAttendees, mediaUrl, sendChatRequest } from "../../lib/api";
import type { Attendee } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { colors } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

type Props = { raceId: string; raceName: string };

export function RaceRunners({ raceId, raceName }: Props) {
  const router = useRouter();
  const { token, subscribe } = useChat();
  const [people, setPeople] = useState<Attendee[] | null>(null);
  const [asking, setAsking] = useState<Attendee | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setPeople(await getAttendees(token, raceId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, raceId]);

  useEffect(() => {
    load();
  }, [load]);

  // Someone accepted or sent a request: refresh the buttons
  useEffect(
    () => subscribe((e) => (e.type === "chat_request" || e.type === "chat_request_accepted") && load()),
    [subscribe, load]
  );

  const openChat = (person: Attendee, matchId: string) =>
    router.push({
      pathname: "/chat/[matchId]",
      params: { matchId, userId: person.userId, name: person.displayName, photo: person.photo ?? "" },
    });

  const send = async () => {
    if (!token || !asking) return;
    setBusy(true);
    setError(null);
    try {
      const request = await sendChatRequest(token, {
        toUserId: asking.userId,
        raceId,
        note: note.trim() || undefined,
      });
      setAsking(null);
      setNote("");
      if (request.status === "accepted" && request.matchId) openChat(asking, request.matchId);
      else load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const accept = async (person: Attendee) => {
    if (!token || !person.requestId) return;
    try {
      const request = await answerChatRequest(token, person.requestId, "accept");
      if (request.matchId) openChat(person, request.matchId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  if (people === null) {
    return error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />;
  }

  return (
    <View>
      <Pressable
        style={styles.discoverButton}
        onPress={() => router.push({ pathname: "/discover", params: { raceId, raceName } })}
      >
        <Text style={styles.discoverText}>See who you match with at this race →</Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      {people.length === 0 && <Text style={styles.empty}>Nobody else has joined yet. Check back closer to race day.</Text>}

      {people.map((p) => (
        <View key={p.userId} style={styles.row}>
          {p.photo ? (
            <Image source={{ uri: mediaUrl(p.photo) }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]} />
          )}
          <View style={styles.info}>
            <Text style={styles.name}>
              {p.displayName}, {p.age} {p.verified && <Text style={styles.verified}>✓</Text>}
            </Text>
            <Text style={styles.meta}>{p.role === "running" ? `Running ${p.eventLabel ?? ""}` : "Supporting"}</Text>
          </View>
          {p.connection === "connected" && p.matchId ? (
            <Pressable style={styles.outline} onPress={() => openChat(p, p.matchId!)}>
              <Text style={styles.outlineText}>Chat</Text>
            </Pressable>
          ) : p.connection === "incoming" ? (
            <Pressable style={styles.primary} onPress={() => accept(p)}>
              <Text style={styles.primaryText}>Accept</Text>
            </Pressable>
          ) : p.connection === "requested" ? (
            <Text style={styles.pending}>Request sent</Text>
          ) : (
            <Pressable style={styles.outline} onPress={() => setAsking(p)}>
              <Text style={styles.outlineText}>Say hi</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Modal visible={asking !== null} transparent animationType="fade" onRequestClose={() => setAsking(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Chat with {asking?.displayName}?</Text>
            <Text style={styles.modalBody}>
              They'll get a request, and you can chat once they accept.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Add a note (optional), e.g. Want to pace the half together?"
              placeholderTextColor={colors.textFaint}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={300}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable style={[styles.primary, styles.wide]} onPress={send} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Send request</Text>}
            </Pressable>
            <Pressable style={styles.cancel} onPress={() => setAsking(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  discoverButton: { backgroundColor: colors.pinkTint, borderRadius: 12, padding: 12, marginBottom: 12 },
  discoverText: { color: colors.pink, fontSize: 14, fontWeight: "700", textAlign: "center" },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: "center", marginVertical: 20 },
  error: { color: colors.dangerText, fontSize: 13, textAlign: "center", marginVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.border },
  avatarEmpty: { borderWidth: 1, borderColor: colors.borderStrong },
  info: { flex: 1 },
  name: { color: colors.heading, fontSize: 15, fontWeight: "600" },
  verified: { color: colors.primary },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  outline: { borderColor: colors.primary, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  outlineText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  primary: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center" },
  primaryText: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
  wide: { paddingVertical: 13 },
  pending: { color: colors.textFaint, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "center", padding: 24 },
  modal: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, maxWidth: 420, width: "100%", alignSelf: "center" },
  modalTitle: { color: colors.heading, fontSize: 19, fontWeight: "700", marginBottom: 6 },
  modalBody: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  input: {
    backgroundColor: colors.bg,
    color: colors.heading,
    borderRadius: 12,
    padding: 12,
    minHeight: 70,
    textAlignVertical: "top",
    fontSize: 15,
    marginBottom: 12,
  },
  cancel: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
