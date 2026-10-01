import { View, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from "react-native";
import { Text, TextInput } from "./ui/Text";
import { useEffect, useMemo, useState } from "react";
import { ApiError, suggestRun } from "../lib/api";
import { toIsoWithOffset } from "../lib/format";
import type { Message } from "../lib/types";
import { ChoiceChips } from "./ChoiceChips";
import { colors } from "../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const DAYS_SHOWN = 14;
const TIMES = ["06:00", "07:00", "08:00", "17:30", "18:00"].map((t) => ({ value: t, label: t }));
const DISTANCES = ["5", "8", "10", "15", "21"].map((km) => ({ value: km, label: `${km} km` }));

type Props = {
  visible: boolean;
  token: string | null;
  matchId: string;
  name: string;
  onClose: () => void;
  onSent: (card: Message) => void;
};

function upcomingDays(): { value: string; label: string; date: Date }[] {
  const today = new Date();
  return Array.from({ length: DAYS_SHOWN }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const label =
      i === 0
        ? "Today"
        : i === 1
          ? "Tomorrow"
          : date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    return { value: String(i), label, date };
  });
}

export function SuggestRunSheet({ visible, token, matchId, name, onClose, onSent }: Props) {
  const days = useMemo(upcomingDays, [visible]); // recompute when reopened, in case the date changed
  const [day, setDay] = useState<string[]>(["1"]);
  const [time, setTime] = useState("07:00");
  const [place, setPlace] = useState("");
  const [distance, setDistance] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const send = async () => {
    if (!token) return;
    const chosen = days.find((d) => d.value === day[0]);
    const startsAt = chosen ? toIsoWithOffset(chosen.date, time) : null;
    if (!startsAt) {
      setError("Enter the time as HH:MM, e.g. 07:00.");
      return;
    }
    if (new Date(startsAt) <= new Date()) {
      setError("Pick a time in the future.");
      return;
    }
    if (place.trim().length < 2) {
      setError("Please say where to meet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const card = await suggestRun(token, matchId, {
        startsAt,
        place: place.trim(),
        distanceKm: distance[0] ? Number(distance[0]) : undefined,
        note: note.trim() || undefined,
      });
      onSent(card);
      setPlace("");
      setNote("");
      setDistance([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.sheet}>
            <Text style={styles.title}>Suggest a run with {name}</Text>

            <Text style={styles.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
              <ChoiceChips options={days} selected={day} onChange={setDay} single />
            </ScrollView>

            <Text style={styles.label}>Time</Text>
            <ChoiceChips options={TIMES} selected={[time]} onChange={([t]) => setTime(t)} single />
            <TextInput
              style={[styles.input, styles.timeInput]}
              value={time}
              onChangeText={setTime}
              placeholder="HH:MM"
              placeholderTextColor={colors.textFaint}
              maxLength={5}
              accessibilityLabel="Start time"
            />

            <Text style={styles.label}>Where to meet</Text>
            <TextInput
              style={styles.input}
              value={place}
              onChangeText={setPlace}
              placeholder="e.g. Delta Park parkrun start, or Emmarentia Dam main gate"
              placeholderTextColor={colors.textFaint}
              maxLength={120}
            />

            <Text style={styles.label}>Distance (optional)</Text>
            <ChoiceChips
              options={DISTANCES}
              selected={distance}
              onChange={(v) => setDistance(v.slice(-1))}
            />

            <TextInput
              style={[styles.input, styles.noteInput]}
              value={note}
              onChangeText={setNote}
              placeholder="Anything else? e.g. easy pace, coffee after (optional)"
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={300}
            />

            <View style={styles.tip}>
              <Text style={styles.tipText}>
                Staying safe: meet somewhere public and busy, in daylight if you can, and tell a
                friend where you're going.
              </Text>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <Pressable style={[styles.primary, busy && styles.disabled]} onPress={send} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Send suggestion</Text>}
            </Pressable>
            <Pressable style={styles.cancel} onPress={onClose} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  scroll: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, width: "100%", maxWidth: 480 },
  title: { color: colors.heading, fontSize: 20, fontWeight: "700", marginBottom: 16 },
  label: { color: colors.heading, fontSize: 15, fontWeight: "600", marginBottom: 10 },
  dayScroll: { marginBottom: 0 },
  input: {
    backgroundColor: colors.bg,
    color: colors.heading,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 20,
  },
  timeInput: { width: 100, textAlign: "center", marginTop: -12 },
  noteInput: { minHeight: 70, textAlignVertical: "top" },
  tip: {
    borderColor: colors.primary,
    borderWidth: 1,
    backgroundColor: colors.primaryTintSoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  tipText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 12, textAlign: "center" },
  primary: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999, alignItems: "center" },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  cancel: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
