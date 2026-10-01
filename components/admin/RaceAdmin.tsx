import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, getAdminRaces, reviewRace } from "../../lib/api";
import { formatRaceDates } from "../../lib/format";
import type { RaceDetail } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { ChoiceChips } from "../ChoiceChips";
import { colors } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const LISTS = [
  { value: "pending", label: "Suggested" },
  { value: "published", label: "Published" },
] as const;

// The Races view of the Moderation tab: review suggestions, add and edit races.
export function RaceAdmin() {
  const router = useRouter();
  const { token } = useChat();
  const [list, setList] = useState<("pending" | "published")[]>(["pending"]);
  const [races, setRaces] = useState<RaceDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setRaces(await getAdminRaces(token, list[0]));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, list]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const review = async (race: RaceDetail, decision: "approve" | "reject") => {
    if (!token) return;
    try {
      await reviewRace(token, race.id, decision);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const edit = (raceId?: string) =>
    router.push(raceId ? { pathname: "/moderation/race-edit", params: { raceId } } : "/moderation/race-edit");

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.addButton} onPress={() => edit()}>
        <Text style={styles.addText}>+ Add a race</Text>
      </Pressable>
      <Text style={styles.hint}>
        Adding many at once? Import a spreadsheet: docker compose exec api python -m app.race_import data/races.csv
      </Text>
      <ChoiceChips
        options={LISTS}
        selected={list}
        onChange={(v) => {
          setRaces(null);
          setList(v);
        }}
        single
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {races === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : races.length === 0 ? (
        <Text style={styles.empty}>{list[0] === "pending" ? "No suggestions to review." : "No races yet."}</Text>
      ) : (
        races.map((race) => (
          <View key={race.id} style={styles.card}>
            <Text style={styles.date}>{formatRaceDates(race.startsOn, race.endsOn)}</Text>
            <Text style={styles.name}>{race.name}</Text>
            <Text style={styles.meta}>
              {race.venue}, {race.city} · {race.events.length} distance{race.events.length === 1 ? "" : "s"} ·{" "}
              {race.attendingCount} going
            </Text>
            {race.officialUrl && <Text style={styles.link}>{race.officialUrl}</Text>}
            <View style={styles.actions}>
              <Pressable style={styles.outline} onPress={() => edit(race.id)}>
                <Text style={styles.outlineText}>Edit</Text>
              </Pressable>
              {list[0] === "pending" && (
                <>
                  <Pressable style={styles.outline} onPress={() => review(race, "reject")}>
                    <Text style={styles.outlineText}>Reject</Text>
                  </Pressable>
                  <Pressable style={styles.primary} onPress={() => review(race, "approve")}>
                    <Text style={styles.primaryText}>Approve</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, maxWidth: 720, width: "100%", alignSelf: "center" },
  addButton: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 12, alignItems: "center", marginBottom: 6 },
  addText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  hint: { color: colors.textFaint, fontSize: 12, marginBottom: 14 },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 10 },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  date: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  name: { color: colors.heading, fontSize: 17, fontWeight: "700", marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  link: { color: colors.textFaint, fontSize: 12, marginTop: 4 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  outline: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  outlineText: { color: colors.text, fontSize: 13 },
  primary: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  primaryText: { color: colors.onPrimary, fontSize: 13, fontWeight: "700" },
});
