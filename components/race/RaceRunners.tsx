import { View, Pressable, StyleSheet, ActivityIndicator, Image, Modal } from "react-native";
import { Text, TextInput } from "../ui/Text";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, answerChatRequest, getAttendees, mediaUrl, sendChatRequest } from "../../lib/api";
import type { Attendee, RaceEvent, RaceRunners as Runners } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { useMembership } from "../MembershipProvider";
import { Dropdown } from "../ui/Dropdown";
import { Button } from "../ui/Button";
import { RACE_PASS } from "../../lib/plans";
import { isUpgradeError, openPlus } from "../../lib/upsell";
import { colors, fonts, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

type Props = { raceId: string; raceName: string; events: RaceEvent[] };

const ALL = "all";

export function RaceRunners({ raceId, raceName, events }: Props) {
  const router = useRouter();
  const { token, subscribe } = useChat();
  const { hasRaceAccess } = useMembership();
  const access = hasRaceAccess(raceId);
  const [list, setList] = useState<Runners | null>(null);
  const [distance, setDistance] = useState<string[]>([ALL]);
  const [similarPace, setSimilarPace] = useState(false);
  const [asking, setAsking] = useState<Attendee | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upgrade = useCallback(
    (reason: string) => openPlus(router, { reason, raceId, raceName }),
    [router, raceId, raceName]
  );

  // Reloads when access changes too, e.g. coming back from buying a race pass
  const load = useCallback(async () => {
    if (!token) return;
    try {
      setList(
        await getAttendees(
          token,
          raceId,
          access ? { raceEventId: distance[0] === ALL ? undefined : distance[0], similarPace } : {}
        )
      );
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, raceId, access, distance, similarPace]);

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
      if (isUpgradeError(e)) {
        setAsking(null);
        upgrade(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      }
    } finally {
      setBusy(false);
    }
  };

  // Filters are part of full access: without it they open the Plus screen
  const filter = (apply: () => void) => {
    if (access) apply();
    else upgrade("Filtering runners by distance and pace comes with Plus or a race pass for this race.");
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

  if (list === null) {
    return error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />;
  }
  const people = list.runners;
  const distanceOptions = [{ value: ALL, label: "All distances" }, ...events.map((e) => ({ value: e.id, label: e.label }))];

  return (
    <View>
      <Pressable
        style={styles.discoverButton}
        onPress={() =>
          access
            ? router.push({ pathname: "/discover", params: { raceId, raceName } })
            : upgrade("Swiping only runners at this race comes with Plus or a race pass.")
        }
      >
        {!access && <Ionicons name="lock-closed" size={14} color={colors.pink} />}
        <Text style={styles.discoverText}>Swipe only runners at this race →</Text>
      </Pressable>

      {events.length > 0 && (
        <View style={styles.filters}>
          <Dropdown
            label="Distance"
            options={distanceOptions}
            selected={distance}
            onChange={(v) => filter(() => setDistance(v.length ? v : [ALL]))}
            style={styles.distanceDrop}
          />
          <Pressable
            style={[styles.paceToggle, similarPace && styles.paceToggleOn]}
            onPress={() => filter(() => setSimilarPace((on) => !on))}
            accessibilityRole="switch"
            accessibilityState={{ checked: similarPace }}
          >
            <Ionicons
              name={access ? "speedometer-outline" : "lock-closed"}
              size={14}
              color={similarPace ? colors.primary : colors.textMuted}
            />
            <Text style={[styles.paceText, similarPace && styles.paceTextOn]}>Similar pace to mine</Text>
          </Pressable>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      {people.length === 0 && list.hiddenCount === 0 && (
        <Text style={styles.empty}>
          {distance[0] !== ALL || similarPace
            ? "Nobody matches these filters yet."
            : "Nobody else has joined yet. Check back closer to race day."}
        </Text>
      )}

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

      {list.hiddenCount > 0 && (
        <View style={styles.locked}>
          <View style={styles.ghosts}>
            {Array.from({ length: Math.min(list.hiddenCount, 5) }, (_, i) => (
              <View key={i} style={[styles.ghost, { marginLeft: i === 0 ? 0 : -12, opacity: 1 - i * 0.12 }]}>
                <Ionicons name="person" size={18} color={colors.textFaint} />
              </View>
            ))}
          </View>
          <Text style={styles.lockedTitle}>
            {list.hiddenCount} more {list.hiddenCount === 1 ? "runner" : "runners"} going
          </Text>
          <Text style={styles.lockedBody}>
            See everyone, filter by distance and pace, and say hi to as many as you like.
          </Text>
          <View style={styles.lockedActions}>
            <Button
              title="Get Plus"
              icon="flash"
              small
              onPress={() => upgrade(`${list.hiddenCount} more runners are going to ${raceName}.`)}
            />
            <Button
              title={`Race pass · ${RACE_PASS.price}`}
              variant="secondary"
              small
              onPress={() => upgrade(`${list.hiddenCount} more runners are going to ${raceName}.`)}
            />
          </View>
        </View>
      )}

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
  discoverButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.pinkTint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  filters: { marginBottom: 6 },
  distanceDrop: { flexGrow: 0, alignSelf: "flex-start", minWidth: 200, marginBottom: 10 },
  paceToggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 8,
  },
  paceToggleOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  paceText: { color: colors.textMuted, fontSize: 13 },
  paceTextOn: { color: colors.primary, fontFamily: fonts.bold },
  locked: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghosts: { flexDirection: "row", marginBottom: 10 },
  ghost: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.border,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedTitle: { color: colors.heading, fontSize: 17, fontFamily: fonts.bold },
  lockedBody: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 4, marginBottom: 14 },
  lockedActions: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "center" },
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
