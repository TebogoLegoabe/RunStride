import {
  View,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  RefreshControl,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Text, TextInput } from "../../../components/ui/Text";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getRaces, suggestRace, type RaceDistance, type RaceFilters, type RacePage } from "../../../lib/api";
import { formatCountdown, formatDistance, formatRaceDates } from "../../../lib/format";
import type { RaceSummary } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Skeleton } from "../../../components/ui/Skeleton";
import { IconButton } from "../../../components/ui/IconButton";
import { Pagination } from "../../../components/ui/Pagination";
import { ChoiceChips } from "../../../components/ChoiceChips";
import { colors, gradient } from "../../../lib/theme";
import { CONTENT_WIDTH, hoverable, useBreakpoint, useColumns, useTopPadding } from "../../../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const VIEWS = [
  { value: "all", label: "Upcoming" },
  { value: "mine", label: "My races" },
] as const;
// Fills whole rows of the 2 and 3 column grids
const PAGE_SIZE = 24;
// The most races the API returns in one request
const MAX_REQUEST = 50;

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

// Common distances to tick when suggesting a race; anything else goes in a custom row
const PRESET_DISTANCES = [
  { value: "5", label: "5 km", km: 5 },
  { value: "10", label: "10 km", km: 10 },
  { value: "21.1", label: "Half marathon", km: 21.1 },
  { value: "42.2", label: "Marathon", km: 42.2 },
] as const;
type CustomDistance = { km: string; name: string };

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
  const { token, subscribe } = useChat();
  const [view, setView] = useState<("all" | "mine")[]>(["all"]);
  const [query, setQuery] = useState("");
  // The search box's text once typing pauses, so we don't search on every keystroke
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState<string[]>(["any"]);
  const [when, setWhen] = useState<When[]>(["any"]);
  const [distances, setDistances] = useState<RaceDistance[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [changingPage, setChangingPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const list = useRef<FlatList<RaceSummary>>(null);
  // Only the newest request may change the list: an older, slower one can arrive last
  const requestId = useRef(0);

  // One column on phones, a grid of cards on tablets and desktops
  const columns = useColumns(300);
  const topPadding = useTopPadding();
  const widthStyle = { maxWidth: columns > 1 ? CONTENT_WIDTH.wide : CONTENT_WIDTH.normal };
  // Phones scroll through races endlessly; bigger screens get numbered pages
  const { isPhone } = useBreakpoint();
  const paged = !isPhone;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const activeFilters = (province[0] !== "any" ? 1 : 0) + (when[0] !== "any" ? 1 : 0) + (distances.length ? 1 : 0);

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const filters = useMemo(
    (): RaceFilters => ({
      q: search || undefined,
      mine: view[0] === "mine",
      province: province[0] !== "any" ? province[0] : undefined,
      distances: distances.length ? distances : undefined,
      ...dateRange(when[0]),
    }),
    [search, view, province, when, distances]
  );

  // Shows races [start, start + count), fetched in chunks the API allows
  const show = useCallback(
    async (start: number, count: number, scrollToTop = false) => {
      if (!token) return;
      const id = ++requestId.current;
      try {
        const chunks: Promise<RacePage>[] = [];
        for (let at = start; at < start + count; at += MAX_REQUEST) {
          chunks.push(getRaces(token, { ...filters, offset: at, limit: Math.min(MAX_REQUEST, start + count - at) }));
        }
        const pages = await Promise.all(chunks);
        if (id !== requestId.current) return;
        setRaces(pages.flatMap((p) => p.races));
        setTotal(pages[0].total);
        setError(null);
        if (scrollToTop) list.current?.scrollToOffset({ offset: 0, animated: false });
      } catch (e) {
        if (id === requestId.current) setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      }
    },
    [token, filters]
  );

  // A new search or filter starts again from the first page
  useEffect(() => {
    setPage(0);
    show(0, PAGE_SIZE, true);
  }, [show, paged]);

  // Coming back from a race: refresh what's on screen (e.g. "You're running") without
  // losing your place. The first focus is covered by the load above.
  const refreshInPlace = () =>
    paged ? show(page * PAGE_SIZE, PAGE_SIZE) : show(0, Math.max(PAGE_SIZE, races?.length ?? 0));
  const refreshRef = useRef(refreshInPlace);
  refreshRef.current = refreshInPlace;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false;
      else refreshRef.current();
    }, [])
  );

  // Someone mentioned you: update that race's badge
  useEffect(() => subscribe((e) => e.type === "race_mention" && refreshRef.current()), [subscribe]);

  const goToPage = async (p: number) => {
    setPage(p);
    setChangingPage(true);
    await show(p * PAGE_SIZE, PAGE_SIZE, true);
    setChangingPage(false);
  };

  const loadMore = async () => {
    if (paged || !token || !races || races.length >= total || loadingMore) return;
    setLoadingMore(true);
    const id = requestId.current; // a new search while this loads makes it stale
    try {
      const next = await getRaces(token, { ...filters, offset: races.length, limit: PAGE_SIZE });
      if (id !== requestId.current) return;
      setRaces((current) => {
        const seen = new Set((current ?? []).map((r) => r.id));
        return [...(current ?? []), ...next.races.filter((r) => !seen.has(r.id))];
      });
      setTotal(next.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setLoadingMore(false);
    }
  };

  const pullToRefresh = async () => {
    setRefreshing(true);
    await show(0, PAGE_SIZE);
    setRefreshing(false);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const far = e.nativeEvent.contentOffset.y > 1200;
    if (far !== showTop) setShowTop(far);
  };

  const clearFilters = () => {
    setProvince(["any"]);
    setWhen(["any"]);
    setDistances([]);
  };

  const hasMore = !!races && races.length < total;
  const first = page * PAGE_SIZE;
  const plural = (n: number) => `${n} ${n === 1 ? "race" : "races"}`;
  const countText = !races?.length
    ? null
    : paged && pageCount > 1
      ? `Showing ${first + 1}–${first + races.length} of ${total} races`
      : view[0] === "mine"
        ? `${plural(total)} you've joined`
        : `${plural(total)}${search || activeFilters ? " found" : " coming up"}`;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={[styles.inner, widthStyle]}>
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
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} accessibilityLabel="Clear search" hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          )}
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
        {countText && <Text style={styles.count}>{countText}</Text>}
      </View>

      {races === null ? (
        <View style={[styles.list, widthStyle, styles.skeletonGrid]}>
          {Array.from({ length: columns > 1 ? columns * 2 : 4 }, (_, i) => (
            <View key={i} style={[styles.cell, { width: `${100 / columns}%` }]}>
              <View style={styles.card}>
                <Skeleton width={110} height={20} round />
                <Skeleton width="75%" height={20} style={styles.skeletonGap} />
                <Skeleton width="50%" height={14} style={styles.skeletonGap} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          ref={list}
          // numColumns can't change on a mounted list
          key={`columns-${columns}`}
          numColumns={columns}
          data={races}
          keyExtractor={(r) => r.id}
          style={changingPage && styles.dimmed}
          contentContainerStyle={[styles.list, widthStyle]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          onScroll={paged ? undefined : onScroll}
          scrollEventThrottle={200}
          refreshControl={
            isPhone ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={pullToRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            ) : undefined
          }
          ListEmptyComponent={
            view[0] === "mine" ? (
              <EmptyState
                icon="flag"
                title="No races yet"
                body="Join a race to chat with other runners going, find a running buddy, and swap entries."
                action={{ title: "Browse upcoming races", icon: "search", onPress: () => setView(["all"]) }}
              />
            ) : (
              <EmptyState
                icon="search"
                title="No races found"
                body={
                  search || activeFilters
                    ? "Nothing matches your search. Try fewer filters, or suggest the race if it's missing."
                    : "No upcoming races yet. Suggest one you're running!"
                }
                action={{ title: "Suggest a race", icon: "add-circle-outline", onPress: () => setSuggestOpen(true) }}
              />
            )
          }
          ListFooterComponent={
            races.length === 0 ? null : paged ? (
              <View style={styles.footer}>
                <Pagination page={page} pageCount={pageCount} onChange={goToPage} disabled={changingPage} />
                <Pressable style={styles.suggestLink} onPress={() => setSuggestOpen(true)}>
                  <Text style={styles.suggestText}>Can't find your race? Suggest it</Text>
                </Pressable>
              </View>
            ) : loadingMore || hasMore ? (
              <ActivityIndicator color={colors.primary} style={styles.spinner} />
            ) : (
              <Pressable style={styles.suggestLink} onPress={() => setSuggestOpen(true)}>
                <Text style={styles.suggestText}>That's every race. Can't find yours? Suggest it</Text>
              </Pressable>
            )
          }
          renderItem={({ item: race, index }) => (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(350)}
              style={[styles.cell, { width: `${100 / columns}%` }]}
            >
              <Pressable
                style={hoverable(({ hovered, pressed }) => [
                  styles.card,
                  styles.cardFill,
                  hovered && styles.cardHover,
                  pressed && styles.cardPressed,
                ])}
                onPress={() => router.push(`/race/${race.id}`)}
              >
                <View style={styles.cardTop}>
                  <LinearGradient
                    colors={gradient.brand}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.dateBadge}
                  >
                    <Ionicons name="calendar-outline" size={12} color={colors.heading} />
                    <Text style={styles.dateText}>{formatRaceDates(race.startsOn, race.endsOn)}</Text>
                  </LinearGradient>
                  {race.unreadMentions > 0 ? (
                    <View style={styles.mentionBadge}>
                      <Ionicons name="at" size={12} color={colors.heading} />
                      <Text style={styles.mentionText}>
                        {race.unreadMentions} {race.unreadMentions === 1 ? "mention" : "mentions"}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.countdown}>{formatCountdown(race.startsOn, race.endsOn)}</Text>
                  )}
                </View>
                <Text style={styles.raceName}>{race.name}</Text>
                <Text style={styles.meta}>
                  {race.venue}, {race.city}
                </Text>
                <View style={styles.cardFooter}>
                  <View style={styles.goingRow}>
                    <Ionicons name="people-outline" size={14} color={colors.textMuted} />
                    <Text style={styles.going}>
                      {race.attendingCount} {race.attendingCount === 1 ? "runner" : "runners"} going
                    </Text>
                  </View>
                  {race.myAttendance && (
                    <Text style={styles.mine}>
                      {race.myAttendance.role === "running"
                        ? `You're running ${race.myAttendance.eventLabel ?? ""}`
                        : "You're supporting"}
                    </Text>
                  )}
                </View>
              </Pressable>
            </Animated.View>
          )}
        />
      )}

      {showTop && !paged && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={styles.topButton}>
          <IconButton
            icon="arrow-up"
            size={48}
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
            accessibilityLabel="Back to the top"
          />
        </Animated.View>
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
  const [presets, setPresets] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomDistance[]>([]);
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
    const events: { label: string; distanceKm: number }[] = PRESET_DISTANCES.filter((d) => presets.includes(d.value)).map((d) => ({
      label: d.label,
      distanceKm: d.km,
    }));
    for (const row of custom) {
      if (!row.km.trim() && !row.name.trim()) continue; // an empty row nobody filled in
      const km = Number(row.km.replace(",", "."));
      if (!(km > 0 && km <= 1000)) {
        setError("Enter each extra distance in km, e.g. 15 or 56.");
        return;
      }
      events.push({ label: row.name.trim() || formatDistance(km), distanceKm: km });
    }
    if (events.length === 0) {
      setError("Pick at least one distance, so runners can say which one they're doing.");
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
        events,
      });
      setSent(true);
      setName("");
      setDate("");
      setVenue("");
      setCity("");
      setLink("");
      setPresets([]);
      setCustom([]);
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
                <Text style={styles.label}>Distances</Text>
                <ChoiceChips options={PRESET_DISTANCES} selected={presets} onChange={setPresets} />
                {custom.map((row, i) => (
                  <View key={i} style={styles.customRow}>
                    <TextInput
                      style={[styles.input, styles.customKm]}
                      value={row.km}
                      onChangeText={(km) => setCustom((rows) => rows.map((r, j) => (j === i ? { ...r, km } : r)))}
                      placeholder="km"
                      placeholderTextColor={colors.textFaint}
                      keyboardType="decimal-pad"
                    />
                    <TextInput
                      style={[styles.input, styles.customName]}
                      value={row.name}
                      onChangeText={(name) => setCustom((rows) => rows.map((r, j) => (j === i ? { ...r, name } : r)))}
                      placeholder="Name (optional), e.g. Trail run"
                      placeholderTextColor={colors.textFaint}
                    />
                    <Pressable
                      onPress={() => setCustom((rows) => rows.filter((_, j) => j !== i))}
                      accessibilityLabel="Remove this distance"
                      hitSlop={8}
                      style={styles.customRemove}
                    >
                      <Ionicons name="close-circle" size={22} color={colors.textFaint} />
                    </Pressable>
                  </View>
                ))}
                <Pressable
                  onPress={() => setCustom((rows) => [...rows, { km: "", name: "" }])}
                  style={styles.addDistance}
                >
                  <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.addDistanceText}>
                    {custom.length ? "Add another distance" : "Add a different distance"}
                  </Text>
                </Pressable>
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
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { paddingHorizontal: 16, width: "100%", alignSelf: "center" },
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
  skeletonGap: { marginTop: 10 },
  // Cells carry half the gutter on each side, so the list adds the other half
  list: { paddingHorizontal: 10, paddingBottom: 32, width: "100%", alignSelf: "center" },
  skeletonGrid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { paddingHorizontal: 6 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "transparent" },
  cardFill: { flex: 1 },
  cardHover: { borderColor: colors.borderStrong, transform: [{ translateY: -2 }] },
  cardPressed: { opacity: 0.85 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  dateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countdown: { color: colors.textFaint, fontSize: 12, fontWeight: "600" },
  mentionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.pink,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mentionText: { color: colors.heading, fontSize: 11, fontWeight: "700" },
  dateText: { color: colors.heading, fontSize: 12, fontWeight: "700" },
  raceName: { color: colors.heading, fontSize: 18, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 8, flexWrap: "wrap" },
  goingRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  going: { color: colors.text, fontSize: 13 },
  count: { color: colors.textFaint, fontSize: 13, marginBottom: 10 },
  footer: { paddingTop: 12, gap: 4 },
  dimmed: { opacity: 0.5 },
  topButton: { position: "absolute", right: 16, bottom: 16 },
  mine: { color: colors.pink, fontSize: 13, fontWeight: "700" },
  suggestLink: { paddingVertical: 16, alignItems: "center" },
  suggestText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  modalScroll: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  modal: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, width: "100%", maxWidth: 440 },
  modalTitle: { color: colors.heading, fontSize: 20, fontWeight: "700", marginBottom: 12 },
  modalBody: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: 6 },
  customRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  customKm: { width: 80 },
  customName: { flex: 1 },
  customRemove: { paddingTop: 13 },
  addDistance: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16, marginTop: 2 },
  addDistanceText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
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
