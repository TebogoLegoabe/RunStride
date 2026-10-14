import { View, Pressable, StyleSheet, ActivityIndicator, Platform } from "react-native";
import { Text } from "../ui/Text";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, getAdminRaces, importRaces, reviewRace, type RaceImportResult } from "../../lib/api";
import { formatDistance, formatRaceDates } from "../../lib/format";
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
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<RaceImportResult | null>(null);

  // Web only: pick a CSV file and send it
  const chooseCsv = () => {
    if (Platform.OS !== "web" || !token) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setError(null);
      setResult(null);
      try {
        const outcome = await importRaces(token, file);
        setResult(outcome);
        if (outcome.imported) load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  const loadMore = async () => {
    if (!token || !races) return;
    try {
      const page = await getAdminRaces(token, list[0], races.length);
      setRaces([...races, ...page.items]);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await getAdminRaces(token, list[0]);
      setRaces(page.items);
      setTotal(page.total);
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
      {Platform.OS === "web" ? (
        <Pressable style={styles.importButton} onPress={chooseCsv} disabled={importing}>
          {importing ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.importText}>Import many from a CSV file</Text>
          )}
        </Pressable>
      ) : (
        <Text style={styles.hint}>To import many races from a spreadsheet, use the web admin (app.runstride.co.za).</Text>
      )}
      {result && (
        <View style={styles.resultBox}>
          {result.imported ? (
            <Text style={styles.resultOk}>
              Done: {result.added} added, {result.updated} updated.
            </Text>
          ) : (
            <>
              <Text style={styles.resultBad}>Nothing was saved. Fix these rows and upload again:</Text>
              {result.errors.map((e) => (
                <Text key={e} style={styles.resultLine}>
                  {e}
                </Text>
              ))}
            </>
          )}
        </View>
      )}
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
              {race.venue}, {race.city} · {race.attendingCount} going
            </Text>
            {race.events.length ? (
              <Text style={styles.distances}>
                {race.events
                  .map((e) => (e.label === formatDistance(e.distanceKm) ? e.label : `${e.label} (${formatDistance(e.distanceKm)})`))
                  .join(" · ")}
              </Text>
            ) : (
              <Text style={styles.noDistances}>No distances yet: add them before approving</Text>
            )}
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
      {races !== null && races.length < total && (
        <Pressable style={styles.more} onPress={loadMore}>
          <Text style={styles.moreText}>
            Load more ({races.length} of {total})
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  importButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingVertical: 11, alignItems: "center", marginBottom: 10 },
  importText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  resultBox: { backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 12 },
  resultOk: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  resultBad: { color: colors.dangerText, fontSize: 14, fontWeight: "700", marginBottom: 6 },
  resultLine: { color: colors.text, fontSize: 12, marginTop: 2 },
  more: { alignSelf: "center", padding: 14 },
  moreText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  distances: { color: colors.text, fontSize: 13, marginTop: 4 },
  noDistances: { color: colors.warningText, fontSize: 13, marginTop: 4 },
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
