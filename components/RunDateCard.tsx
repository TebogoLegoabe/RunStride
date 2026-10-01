import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, answerRun } from "../lib/api";
import { formatRunTime } from "../lib/format";
import type { RunDate } from "../lib/types";
import { colors } from "../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

type Props = {
  run: RunDate;
  myId: string | null;
  token: string | null;
  otherName: string;
  onUpdated: (run: RunDate) => void;
};

const STATUS_TEXT: Record<RunDate["status"], string> = {
  proposed: "Waiting for a reply",
  accepted: "You're running together! 🎉",
  declined: "Declined",
  cancelled: "Cancelled",
};

export function RunDateCard({ run, myId, token, otherName, onUpdated }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = run.proposedById === myId;
  const past = new Date(run.startsAt) < new Date();
  const live = run.status === "proposed" || run.status === "accepted";

  const act = async (action: "accept" | "decline" | "cancel") => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      onUpdated(await answerRun(token, run.id, action));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.card, !live && styles.cardDone]}>
      <View style={styles.header}>
        <Ionicons name="walk" size={18} color={colors.primary} />
        <Text style={styles.heading}>{mine ? "You suggested a run" : `${otherName} suggested a run`}</Text>
      </View>

      <Text style={styles.when}>{formatRunTime(run.startsAt)}</Text>
      <View style={styles.row}>
        <Ionicons name="location-outline" size={15} color={colors.textMuted} />
        <Text style={styles.place}>{run.place}</Text>
      </View>
      {run.distanceKm && <Text style={styles.detail}>{run.distanceKm} km</Text>}
      {run.note && <Text style={styles.note}>“{run.note}”</Text>}

      <Text style={[styles.status, run.status === "accepted" && styles.statusAccepted]}>
        {past && run.status === "proposed" ? "This time has passed" : STATUS_TEXT[run.status]}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {!past && run.status === "proposed" && !mine && (
        <View style={styles.actions}>
          <Pressable style={[styles.button, styles.decline]} onPress={() => act("decline")} disabled={busy}>
            <Text style={styles.declineText}>Can't make it</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.accept]} onPress={() => act("accept")} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.acceptText}>I'm in!</Text>}
          </Pressable>
        </View>
      )}
      {run.status === "accepted" && (
        <Pressable style={styles.safetyButton} onPress={() => router.push(`/run/${run.id}`)}>
          <Ionicons name={past ? "chatbubble-ellipses-outline" : "shield-checkmark-outline"} size={16} color={colors.onPrimary} />
          <Text style={styles.safetyText}>{past ? "How did it go?" : "Run safety & live sharing"}</Text>
        </Pressable>
      )}
      {!past && live && (mine || run.status === "accepted") && (
        <Pressable style={styles.cancel} onPress={() => act("cancel")} disabled={busy}>
          <Text style={styles.cancelText}>Cancel run</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    width: "92%",
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
  },
  cardDone: { borderColor: colors.border, opacity: 0.75 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  heading: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  when: { color: colors.heading, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  place: { color: colors.textBright, fontSize: 15, flexShrink: 1 },
  detail: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  note: { color: colors.text, fontSize: 14, fontStyle: "italic", marginTop: 6 },
  status: { color: colors.textMuted, fontSize: 13, marginTop: 10 },
  statusAccepted: { color: colors.primary, fontWeight: "700" },
  error: { color: colors.dangerText, fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center" },
  accept: { backgroundColor: colors.primary },
  acceptText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
  decline: { borderColor: colors.borderStrong, borderWidth: 1 },
  declineText: { color: colors.text, fontSize: 15 },
  safetyButton: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 12,
  },
  safetyText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  cancel: { marginTop: 10, alignSelf: "flex-start" },
  cancelText: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline" },
});
