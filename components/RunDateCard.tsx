import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, answerRun } from "../lib/api";
import { formatRunTime } from "../lib/format";
import type { RunDate } from "../lib/types";

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
        <Ionicons name="walk" size={18} color="#4ecdc4" />
        <Text style={styles.heading}>{mine ? "You suggested a run" : `${otherName} suggested a run`}</Text>
      </View>

      <Text style={styles.when}>{formatRunTime(run.startsAt)}</Text>
      <View style={styles.row}>
        <Ionicons name="location-outline" size={15} color="#94a3b8" />
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
            {busy ? <ActivityIndicator color="#0f172a" /> : <Text style={styles.acceptText}>I'm in!</Text>}
          </Pressable>
        </View>
      )}
      {run.status === "accepted" && (
        <Pressable style={styles.safetyButton} onPress={() => router.push(`/run/${run.id}`)}>
          <Ionicons name={past ? "chatbubble-ellipses-outline" : "shield-checkmark-outline"} size={16} color="#0f172a" />
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
    backgroundColor: "#1e293b",
    borderColor: "#4ecdc4",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginVertical: 8,
  },
  cardDone: { borderColor: "#334155", opacity: 0.75 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  heading: { color: "#94a3b8", fontSize: 13, fontWeight: "600" },
  when: { color: "#ffffff", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 4 },
  place: { color: "#e2e8f0", fontSize: 15, flexShrink: 1 },
  detail: { color: "#94a3b8", fontSize: 14, marginTop: 2 },
  note: { color: "#cbd5e1", fontSize: 14, fontStyle: "italic", marginTop: 6 },
  status: { color: "#94a3b8", fontSize: 13, marginTop: 10 },
  statusAccepted: { color: "#4ecdc4", fontWeight: "700" },
  error: { color: "#f87171", fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  button: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: "center" },
  accept: { backgroundColor: "#4ecdc4" },
  acceptText: { color: "#0f172a", fontWeight: "700", fontSize: 15 },
  decline: { borderColor: "#475569", borderWidth: 1 },
  declineText: { color: "#cbd5e1", fontSize: 15 },
  safetyButton: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4ecdc4",
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 12,
  },
  safetyText: { color: "#0f172a", fontWeight: "700", fontSize: 14 },
  cancel: { marginTop: 10, alignSelf: "flex-start" },
  cancelText: { color: "#94a3b8", fontSize: 13, textDecorationLine: "underline" },
});
