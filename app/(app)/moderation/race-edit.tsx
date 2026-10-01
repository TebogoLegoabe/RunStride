import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, createRace, getRace, updateRace } from "../../../lib/api";
import { toIsoWithOffset } from "../../../lib/format";
import type { RaceInput } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { ChoiceChips } from "../../../components/ChoiceChips";
import { colors } from "../../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "Northern Cape", "North West", "Western Cape",
].map((p) => ({ value: p, label: p }));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type EventDraft = { id?: string; label: string; km: string; start: string }; // start: "YYYY-MM-DD HH:MM" local

const pad = (n: number) => String(n).padStart(2, "0");

// ISO timestamp -> "YYYY-MM-DD HH:MM" in this device's time, for editing
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "YYYY-MM-DD HH:MM" -> ISO with this device's UTC offset; null if empty, undefined if invalid
function fromLocalInput(value: string): string | null | undefined {
  const v = value.trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}:\d{2})$/.exec(v);
  if (!m) return undefined;
  return toIsoWithOffset(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), m[4]) ?? undefined;
}

// Admins: add a race, or edit one (including approving a suggestion with full details)
export default function RaceEdit() {
  const router = useRouter();
  const { raceId } = useLocalSearchParams<{ raceId?: string }>();
  const { token } = useChat();
  const [loading, setLoading] = useState(!!raceId);
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState<string[]>([]);
  const [officialUrl, setOfficialUrl] = useState("");
  const [subOpens, setSubOpens] = useState("");
  const [subCloses, setSubCloses] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [events, setEvents] = useState<EventDraft[]>([{ label: "", km: "", start: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !raceId) return;
    getRace(token, raceId)
      .then((r) => {
        setName(r.name);
        setStartsOn(r.startsOn);
        setEndsOn(r.endsOn === r.startsOn ? "" : r.endsOn);
        setVenue(r.venue);
        setCity(r.city);
        setProvince(r.province ? [r.province] : []);
        setOfficialUrl(r.officialUrl ?? "");
        setSubOpens(r.substitutionOpensOn ?? "");
        setSubCloses(r.substitutionClosesOn ?? "");
        setSubUrl(r.substitutionUrl ?? "");
        setEvents(
          r.events.length
            ? r.events.map((e) => ({ id: e.id, label: e.label, km: String(e.distanceKm), start: toLocalInput(e.startsAt) }))
            : [{ label: "", km: "", start: "" }]
        );
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : NETWORK_ERROR))
      .finally(() => setLoading(false));
  }, [token, raceId]);

  const setEvent = (index: number, patch: Partial<EventDraft>) =>
    setEvents((current) => current.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  const build = (): RaceInput | string => {
    if (!name.trim() || !venue.trim() || !city.trim()) return "Fill in the name, venue and town.";
    for (const [label, value] of [["Start date", startsOn], ["End date", endsOn], ["Transfer window opens", subOpens], ["Transfer window closes", subCloses]] as const) {
      if (value && !DATE.test(value)) return `${label}: use YYYY-MM-DD.`;
    }
    if (!startsOn) return "Add the start date.";
    const filled = events.filter((e) => e.label.trim() || e.km.trim());
    const out: RaceInput["events"] = [];
    for (const e of filled) {
      const km = Number(e.km);
      if (!e.label.trim() || !(km > 0)) return "Each distance needs a name and a distance in km.";
      const startsAt = fromLocalInput(e.start);
      if (startsAt === undefined) return `Start time for ${e.label}: use YYYY-MM-DD HH:MM.`;
      out.push({ id: e.id, label: e.label.trim(), distanceKm: km, startsAt });
    }
    return {
      name: name.trim(),
      startsOn,
      endsOn: endsOn || undefined,
      venue: venue.trim(),
      city: city.trim(),
      province: province[0] ?? null,
      officialUrl: officialUrl.trim() || null,
      substitutionOpensOn: subOpens || null,
      substitutionClosesOn: subCloses || null,
      substitutionUrl: subUrl.trim() || null,
      events: out,
    };
  };

  const save = async () => {
    if (!token) return;
    const body = build();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (raceId) await updateRace(token, raceId, body);
      else await createRace(token, body);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const input = (label: string, value: string, set: (v: string) => void, placeholder = "", caps = true) => (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCapitalize={caps ? "words" : "none"}
      />
    </>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={colors.textBright} />
        <Text style={styles.backText}>Races</Text>
      </Pressable>
      <Text style={styles.title}>{raceId ? "Edit race" : "Add a race"}</Text>

      {input("Race name", name, setName, "e.g. Intercare Blouberg Marathon")}
      {input("Start date", startsOn, setStartsOn, "YYYY-MM-DD", false)}
      {input("End date (multi-day races only)", endsOn, setEndsOn, "YYYY-MM-DD", false)}
      {input("Venue", venue, setVenue, "Where it starts")}
      {input("Town or city", city, setCity)}
      <Text style={styles.label}>Province</Text>
      <ChoiceChips options={PROVINCES} selected={province} onChange={setProvince} single />
      {input("Official race page", officialUrl, setOfficialUrl, "https://", false)}

      <Text style={styles.section}>Distances</Text>
      {events.map((e, i) => (
        <View key={e.id ?? `new-${i}`} style={styles.eventBox}>
          <View style={styles.eventRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={e.label}
              onChangeText={(v) => setEvent(i, { label: v })}
              placeholder="Name, e.g. Half marathon"
              placeholderTextColor={colors.textFaint}
            />
            <TextInput
              style={[styles.input, styles.km]}
              value={e.km}
              onChangeText={(v) => setEvent(i, { km: v.replace(/[^\d.]/g, "") })}
              placeholder="km"
              placeholderTextColor={colors.textFaint}
              keyboardType="decimal-pad"
            />
          </View>
          <TextInput
            style={styles.input}
            value={e.start}
            onChangeText={(v) => setEvent(i, { start: v })}
            placeholder="Start: YYYY-MM-DD HH:MM (optional)"
            placeholderTextColor={colors.textFaint}
          />
          {events.length > 1 && (
            <Pressable onPress={() => setEvents((current) => current.filter((_, j) => j !== i))}>
              <Text style={styles.remove}>Remove distance</Text>
            </Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={() => setEvents((current) => [...current, { label: "", km: "", start: "" }])}>
        <Text style={styles.addLink}>+ Add a distance</Text>
      </Pressable>

      <Text style={styles.section}>Official entry transfer window</Text>
      <Text style={styles.hint}>
        The swap board only opens between these dates. Leave both empty if the race doesn't allow transfers.
      </Text>
      {input("Opens", subOpens, setSubOpens, "YYYY-MM-DD", false)}
      {input("Closes", subCloses, setSubCloses, "YYYY-MM-DD", false)}
      {input("Organiser's transfer page", subUrl, setSubUrl, "https://", false)}

      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.primary} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Save race</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingTop: 44, paddingBottom: 60, maxWidth: 640, width: "100%", alignSelf: "center" },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { color: colors.textBright, fontSize: 16 },
  title: { color: colors.heading, fontSize: 24, fontWeight: "700", marginBottom: 16 },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: colors.surface, color: colors.heading, borderRadius: 12, padding: 12, fontSize: 15, marginBottom: 12 },
  section: { color: colors.heading, fontSize: 17, fontWeight: "700", marginTop: 12, marginBottom: 8 },
  hint: { color: colors.textFaint, fontSize: 12, marginBottom: 10 },
  eventBox: { borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 10 },
  eventRow: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  km: { width: 80, textAlign: "center" },
  remove: { color: colors.dangerText, fontSize: 13 },
  addLink: { color: colors.primary, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  error: { color: colors.dangerText, fontSize: 14, marginVertical: 10 },
  primary: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: "center", marginTop: 10 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
});
