import { View, Pressable, StyleSheet, ActivityIndicator, ScrollView, Linking, KeyboardAvoidingView, Platform } from "react-native";
import { Text } from "../../../components/ui/Text";
import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getMe, getRace, leaveRace, setAttendance } from "../../../lib/api";
import { formatDayTime, formatDistance, formatRaceDates } from "../../../lib/format";
import type { RaceDetail } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { ChoiceChips } from "../../../components/ChoiceChips";
import { RaceChat } from "../../../components/race/RaceChat";
import { RaceRunners } from "../../../components/race/RaceRunners";
import { RaceSwaps } from "../../../components/race/RaceSwaps";
import { colors } from "../../../lib/theme";
import { CONTENT_WIDTH, useBreakpoint, useTopPadding } from "../../../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const SUPPORTING = "supporting";
const SECTIONS = [
  { value: "chat", label: "Chat" },
  { value: "runners", label: "Runners" },
  { value: "swaps", label: "Entry swaps" },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

export default function RacePage() {
  const topPadding = useTopPadding();
  // Wide screens: race details on the left, chat / runners / swaps on the right
  const { isWide } = useBreakpoint();
  const router = useRouter();
  const { raceId } = useLocalSearchParams<{ raceId: string }>();
  const { token } = useChat();
  const [race, setRace] = useState<RaceDetail | null>(null);
  const [me, setMe] = useState<{ id: string; isAdmin: boolean } | null>(null);
  const [section, setSection] = useState<Section[]>(["chat"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [r, m] = await Promise.all([getRace(token, raceId), getMe(token)]);
      setRace(r);
      setMe({ id: m.id, isAdmin: m.isAdmin });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, raceId]);

  useEffect(() => {
    load();
  }, [load]);

  const choose = async ([choice]: string[]) => {
    if (!token || !race || !choice) return;
    setBusy(true);
    setError(null);
    try {
      setRace(
        await setAttendance(
          token,
          race.id,
          choice === SUPPORTING ? { role: "supporting" } : { role: "running", raceEventId: choice }
        )
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    if (!token || !race) return;
    setBusy(true);
    try {
      setRace(await leaveRace(token, race.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  if (!race) {
    return (
      <View style={[styles.container, styles.centered]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const going = race.myAttendance;
  const choice = going ? (going.role === "supporting" ? SUPPORTING : going.raceEventId ?? "") : "";
  const options = [
    ...race.events.map((e) => ({ value: e.id, label: `Running ${e.label}` })),
    { value: SUPPORTING, label: "Supporting" },
  ];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPadding, maxWidth: isWide && going ? CONTENT_WIDTH.wide : CONTENT_WIDTH.normal },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/races"))}
          style={styles.back}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textBright} />
          <Text style={styles.backText}>Races</Text>
        </Pressable>

        <View style={isWide && going ? styles.columns : undefined}>
        <View style={isWide && going ? styles.infoColumn : undefined}>

        <Text style={styles.date}>{formatRaceDates(race.startsOn, race.endsOn)}</Text>
        <Text style={styles.title}>{race.name}</Text>
        <Text style={styles.meta}>
          {race.venue}, {race.city}
          {race.province ? `, ${race.province}` : ""}
        </Text>
        {race.status === "pending" && (
          <Text style={styles.pending}>Waiting for approval. Only you can see this race for now.</Text>
        )}
        {race.officialUrl && (
          <Pressable onPress={() => Linking.openURL(race.officialUrl!)}>
            <Text style={styles.link}>Official race page →</Text>
          </Pressable>
        )}

        {race.events.length > 0 && (
          <View style={styles.box}>
            {race.events.map((e) => (
              <View key={e.id} style={styles.eventRow}>
                <Text style={styles.eventLabel}>{e.label}</Text>
                <Text style={styles.eventMeta}>
                  {formatDistance(e.distanceKm)}
                  {e.startsAt ? ` · ${formatDayTime(e.startsAt)}` : ""}
                  {e.runnerCount ? ` · ${e.runnerCount} on RunStride` : ""}
                </Text>
              </View>
            ))}
          </View>
        )}

        {race.status === "published" && (
          <>
            <Text style={styles.section}>Are you going?</Text>
            <ChoiceChips options={options} selected={choice ? [choice] : []} onChange={choose} single />
            {going && (
              <Pressable onPress={leave} disabled={busy}>
                <Text style={styles.leave}>I'm not going any more</Text>
              </Pressable>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        </View>

        {going ? (
          <View style={isWide ? styles.sectionColumn : undefined}>
            <View style={[styles.sectionPicker, isWide && styles.sectionPickerWide]}>
              <ChoiceChips options={SECTIONS} selected={section} onChange={setSection} single />
            </View>
            {section[0] === "chat" && <RaceChat raceId={race.id} myId={me?.id ?? null} isAdmin={!!me?.isAdmin} />}
            {section[0] === "runners" && <RaceRunners raceId={race.id} raceName={race.name} />}
            {section[0] === "swaps" && <RaceSwaps race={race} />}
          </View>
        ) : (
          race.status === "published" && (
            <Text style={styles.joinHint}>
              {race.attendingCount > 0
                ? `${race.attendingCount} ${race.attendingCount === 1 ? "runner is" : "runners are"} going. Join to see who, chat with them and use the entry swap board.`
                : "Be the first on RunStride to join this race."}
            </Text>
          )
        )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 48, width: "100%", alignSelf: "center" },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 32 },
  infoColumn: { width: 360 },
  sectionColumn: { flex: 1, minWidth: 0 },
  sectionPickerWide: { marginTop: 0, borderTopWidth: 0, paddingTop: 0 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { color: colors.textBright, fontSize: 16 },
  date: { color: colors.primary, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  title: { color: colors.heading, fontSize: 26, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 15, marginTop: 4 },
  pending: { color: colors.warningText, fontSize: 13, marginTop: 8 },
  link: { color: colors.primary, fontSize: 14, fontWeight: "700", marginTop: 10 },
  box: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginTop: 16 },
  eventRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventLabel: { color: colors.heading, fontSize: 15, fontWeight: "600" },
  eventMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  section: { color: colors.heading, fontSize: 16, fontWeight: "700", marginTop: 22, marginBottom: 10 },
  leave: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline", marginTop: -12, marginBottom: 8 },
  error: { color: colors.dangerText, fontSize: 14, marginTop: 8 },
  sectionPicker: { marginTop: 18, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
  joinHint: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 8 },
});
