import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
} from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getRaces, suggestRace, type RaceDistance, type RaceFilters } from "../../../lib/api";
import { formatRaceDates } from "../../../lib/format";
import type { RaceSummary } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { ChoiceChips } from "../../../components/ChoiceChips";
import { colors } from "../../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const VIEWS = [
  { value: "all", label: "Upcoming" },
  { value: "mine", label: "My races" },
] as const;
const PAGE_SIZE = 20;

const PROVINCES = [
  "Western Cape", "Gauteng", "KwaZulu-Natal", "Eastern Cape", "Free State",
  "Limpopo", "Mpumalanga", "North West", "Northern Cape",
];
const PROVINCE_OPTIONS = [{ value: "any", label: "All provinces" }, ...PROVINCES.map((p) => ({ value: p, label: p }))];
const WHEN_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "weekend", label: "This weekend" },
  { value: "month", label: "This month" },
  { value: "3months", label: "Next 3 months" },
] as const;
const DISTANCE_OPTIONS = [
  { value: "5k", label: "5K" },
  { value: "10k", label: "10K" },
  { value: "half", label: "Half" },
  { value: "marathon", label: "Marathon" },
  { value: "ultra", label: "Ultra" },
] as const;
type When = (typeof WHEN_OPTIONS)[number]["value"];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Date range for a "when" choice, in local dates
function dateRange(when: When): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  const at = (offsetDays: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays);
  switch (when) {
    case "weekend": {
      const day = today.getDay(); // 0 Sunday ... 6 Saturday
      if (day === 0) return { dateFrom: ymd(today), dateTo: ymd(today) };
      const saturday = day === 6 ? 0 : 6 - day;
      return { dateFrom: ymd(at(saturday)), dateTo: ymd(at(saturday + 1)) };
    }
    case "month":
      return { dateFrom: ymd(today), dateTo: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
    case "3months":
      return { dateFrom: ymd(today), dateTo: ymd(at(90)) };
    default:
      return {};
  }
}

export default function Races() {
  const router = useRouter();
  const { token } = useChat();
  const [view, setView] = useState<("all" | "mine")[]>(["all"]);
  const [query, setQuery] = useState("");
  const [province, setProvince] = useState<string[]>(["any"]);
  const [when, setWhen] = useState<When[]>(["any"]);
  const [distances, setDistances] = useState<RaceDistance[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const activeFilters = (province[0] !== "any" ? 1 : 0) + (when[0] !== "any" ? 1 : 0) + (distances.length ? 1 : 0);

  const filters = useCallback(
    (): RaceFilters => ({
      q: query.trim() || undefined,
      mine: view[0] === "mine",
      province: province[0] !== "any" ? province[0] : undefined,
      distances: distances.length ? distances : undefined,
      limit: PAGE_SIZE,
      ...dateRange(when[0]),
    }),
    [query, view, province, when, distances]
  );

  // First page, whenever the search or filters change
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await getRaces(token, filters());
      setRaces(page);
      setHasMore(page.length === PAGE_SIZE);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, filters]);

  const loadMore = async () => {
    if (!token || !races || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getRaces(token, { ...filters(), offset: races.length });
      setRaces((current) => {
        const seen = new Set((current ?? []).map((r) => r.id));
        return [...(current ?? []), ...page.filter((r) => !seen.has(r.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setProvince(["any"]);
    setWhen(["any"]);
    setDistances([]);
  };

  // Search as you type, but not on every keystroke
  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.heading}>Races</Text>
        <Text style={styles.subheading}>Meet runners at the start line.</Text>
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            style={styles.search}
            placeholder="Search races or towns"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
          />
        </View>
        <View style={styles.viewRow}>
          <View style={styles.flex}>
            <ChoiceChips options={VIEWS} selected={view} onChange={setView} single />
          </View>
          <Pressable
            style={[styles.filterButton, activeFilters > 0 && styles.filterButtonOn]}
            onPress={() => setFiltersOpen((o) => !o)}
          >
            <Ionicons name="options-outline" size={16} color={activeFilters ? colors.primary : colors.text} />
            <Text style={[styles.filterButtonText, activeFilters > 0 && styles.filterButtonTextOn]}>
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </Text>
          </Pressable>
        </View>
        {filtersOpen && (
          <View style={styles.filterPanel}>
            <Text style={styles.filterLabel}>Where</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <ChoiceChips options={PROVINCE_OPTIONS} selected={province} onChange={setProvince} single />
            </ScrollView>
            <Text style={styles.filterLabel}>When</Text>
            <ChoiceChips options={WHEN_OPTIONS} selected={when} onChange={setWhen} single />
            <Text style={styles.filterLabel}>Distance</Text>
            <ChoiceChips options={DISTANCE_OPTIONS} selected={distances} onChange={setDistances} />
            {activeFilters > 0 && (
              <Pressable onPress={clearFilters}>
                <Text style={styles.clearText}>Clear filters</Text>
              </Pressable>
            )}
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {races === null ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : (
        <FlatList
          data={races}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {view[0] === "mine"
                ? "You haven't joined any races yet."
                : query || activeFilters
                  ? "No upcoming races match. Try fewer filters."
                  : "No upcoming races yet."}
            </Text>
          }
          ListFooterComponent={
            loadingMore || hasMore ? (
              <ActivityIndicator color={colors.primary} style={styles.spinner} />
            ) : (
              <Pressable style={styles.suggestLink} onPress={() => setSuggestOpen(true)}>
                <Text style={styles.suggestText}>Can't find your race? Suggest it</Text>
              </Pressable>
            )
          }
          renderItem={({ item: race }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/race/${race.id}`)}>
              <View style={styles.dateBadge}>
                <Text style={styles.dateText}>{formatRaceDates(race.startsOn, race.endsOn)}</Text>
              </View>
              <Text style={styles.raceName}>{race.name}</Text>
              <Text style={styles.meta}>
                {race.venue}, {race.city}
              </Text>
              <View style={styles.footer}>
                <Text style={styles.going}>
                  {race.attendingCount} {race.attendingCount === 1 ? "runner" : "runners"} going
                </Text>
                {race.myAttendance && (
                  <Text style={styles.mine}>
                    {race.myAttendance.role === "running"
                      ? `You're running ${race.myAttendance.eventLabel ?? ""}`
                      : "You're supporting"}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}

      <SuggestRaceModal
        visible={suggestOpen}
        token={token}
        onClose={() => setSuggestOpen(false)}
      />
    </View>
  );
}

function SuggestRaceModal({
  visible,
  token,
  onClose,
}: {
  visible: boolean;
  token: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (visible) {
      setError(null);
      setSent(false);
    }
  }, [visible]);

  const submit = async () => {
    if (!token) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError("Enter the date as YYYY-MM-DD, e.g. 2026-11-15.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await suggestRace(token, {
        name: name.trim(),
        startsOn: date.trim(),
        venue: venue.trim(),
        city: city.trim(),
        officialUrl: link.trim() || undefined,
      });
      setSent(true);
      setName("");
      setDate("");
      setVenue("");
      setCity("");
      setLink("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        autoCapitalize={label === "Official link (optional)" ? "none" : "words"}
      />
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.modal}>
            {sent ? (
              <>
                <Text style={styles.modalTitle}>Thanks!</Text>
                <Text style={styles.modalBody}>
                  We'll check the details and add it to the list. You'll find it here once it's approved.
                </Text>
                <Pressable style={styles.primaryButton} onPress={onClose}>
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Suggest a race</Text>
                {field("Race name", name, setName, "e.g. Two Oceans Marathon")}
                {field("Date", date, setDate, "YYYY-MM-DD")}
                {field("Venue", venue, setVenue, "Where it starts")}
                {field("Town or city", city, setCity, "e.g. Cape Town")}
                {field("Official link (optional)", link, setLink, "https://")}
                {error && <Text style={styles.error}>{error}</Text>}
                <Pressable style={styles.primaryButton} onPress={submit} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Send</Text>}
                </Pressable>
                <Pressable style={styles.cancelButton} onPress={onClose}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: 48 },
  inner: { paddingHorizontal: 16, maxWidth: 640, width: "100%", alignSelf: "center" },
  heading: { fontSize: 26, fontWeight: "700", color: colors.heading },
  subheading: { fontSize: 14, color: colors.textMuted, marginTop: 2, marginBottom: 14 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  search: { flex: 1, color: colors.heading, fontSize: 15, paddingVertical: 12 },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 10 },
  viewRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  flex: { flex: 1 },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterButtonOn: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  filterButtonText: { color: colors.text, fontSize: 14 },
  filterButtonTextOn: { color: colors.primary, fontWeight: "700" },
  filterPanel: { backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 12 },
  filterLabel: { color: colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 8 },
  clearText: { color: colors.primary, fontSize: 13, fontWeight: "700", marginTop: -8 },
  spinner: { marginTop: 32 },
  list: { paddingHorizontal: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 32 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12 },
  dateBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primaryTint,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  dateText: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  raceName: { color: colors.heading, fontSize: 18, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 8, flexWrap: "wrap" },
  going: { color: colors.text, fontSize: 13 },
  mine: { color: colors.pink, fontSize: 13, fontWeight: "700" },
  suggestLink: { paddingVertical: 16, alignItems: "center" },
  suggestText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  modalScroll: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  modal: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, width: "100%", maxWidth: 440 },
  modalTitle: { color: colors.heading, fontSize: 20, fontWeight: "700", marginBottom: 12 },
  modalBody: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg,
    color: colors.heading,
    borderRadius: 12,
    padding: 13,
    fontSize: 15,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 4,
  },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
  cancelButton: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
