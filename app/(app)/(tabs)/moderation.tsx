import { View, StyleSheet, Pressable, ActivityIndicator, FlatList, ScrollView } from "react-native";
import { Text } from "../../../components/ui/Text";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, getReports } from "../../../lib/api";
import { formatWhen, labelFor } from "../../../lib/format";
import { REPORT_REASONS } from "../../../lib/options";
import type { ReportSummary } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { Dropdown } from "../../../components/ui/Dropdown";
import { RaceAdmin } from "../../../components/admin/RaceAdmin";
import { IdChecks } from "../../../components/admin/IdChecks";
import { Overview } from "../../../components/admin/Overview";
import { People } from "../../../components/admin/People";
import { FeedbackList } from "../../../components/admin/FeedbackList";
import { colors } from "../../../lib/theme";
import { useTopPadding } from "../../../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "people", label: "People" },
  { value: "ids", label: "ID checks" },
  { value: "feedback", label: "Feedback" },
  { value: "races", label: "Races" },
  { value: "open", label: "Reports: open" },
  { value: "resolved", label: "Reports: resolved" },
] as const;

type Section = (typeof VIEWS)[number]["value"];
// Sections that aren't a list of reports
const NOT_REPORTS: Section[] = ["overview", "people", "ids", "races", "feedback"];

// Admins only (the tab is hidden for everyone else, and the API refuses non-admins)
export default function ModerationQueue() {
  const topPadding = useTopPadding();
  const router = useRouter();
  const { token } = useChat();
  // A notification opens the tab on the list that needs attention
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<Section[]>(["overview"]);
  useEffect(() => {
    if (params.view === "ids" || params.view === "races" || params.view === "feedback" || params.view === "open") setView([params.view]);
  }, [params.view]);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [reportTotal, setReportTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!token || !reports || NOT_REPORTS.includes(view[0])) return;
    try {
      const page = await getReports(token, view[0] as "open" | "resolved", reports.length);
      setReports([...reports, ...page.items]);
      setReportTotal(page.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const load = useCallback(async () => {
    if (!token || NOT_REPORTS.includes(view[0])) return;
    const status = view[0] as "open" | "resolved";
    try {
      const page = await getReports(token, status);
      setReports(page.items);
      setReportTotal(page.total);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, view]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.inner}>
        <Text style={styles.heading}>Admin</Text>
        <Dropdown
          label="Section"
          options={VIEWS}
          selected={view}
          onChange={(v) => {
            setReports(null);
            setView(v);
          }}
          style={styles.section}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {view[0] === "overview" ? (
        <ScrollView>
          <Overview go={(section) => setView([section])} />
        </ScrollView>
      ) : view[0] === "feedback" ? (
        <ScrollView>
          <FeedbackList />
        </ScrollView>
      ) : view[0] === "people" ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          <People />
        </ScrollView>
      ) : view[0] === "races" ? (
        <ScrollView>
          <RaceAdmin />
        </ScrollView>
      ) : view[0] === "ids" ? (
        <ScrollView>
          <IdChecks />
        </ScrollView>
      ) : reports === null ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          ListFooterComponent={
            reports.length < reportTotal ? (
              <Pressable style={styles.more} onPress={loadMore}>
                <Text style={styles.moreText}>
                  Load more ({reports.length} of {reportTotal})
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.empty}>{view[0] === "open" ? "Nothing to review. 🎉" : "No resolved reports yet."}</Text>
          }
          renderItem={({ item: r }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/moderation/${r.id}`)}>
              <View style={styles.rowTop}>
                <Text style={styles.reason}>{labelFor(REPORT_REASONS, r.reason)}</Text>
                <Text style={styles.when}>{formatWhen(r.createdAt)}</Text>
              </View>
              <Text style={styles.meta}>
                {r.reported.displayName ?? "Deleted account"}
                {r.reported.openReportCount > 1 ? ` · ${r.reported.openReportCount} open reports` : ""}
                {r.reported.accountStatus && r.reported.accountStatus !== "active"
                  ? ` · ${r.reported.accountStatus}`
                  : ""}
              </Text>
              {r.details && (
                <Text style={styles.details} numberOfLines={2}>
                  “{r.details}”
                </Text>
              )}
              {r.resolution && <Text style={styles.resolution}>Resolved: {r.resolution}</Text>}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { paddingHorizontal: 16, maxWidth: 720, width: "100%", alignSelf: "center" },
  heading: { fontSize: 26, fontWeight: "700", color: colors.heading, marginBottom: 12 },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 12 },
  spinner: { marginTop: 32 },
  section: { flexGrow: 0, alignSelf: "flex-start", minWidth: 220, marginBottom: 14 },
  more: { alignSelf: "center", padding: 14 },
  moreText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 32 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  reason: { color: colors.heading, fontSize: 16, fontWeight: "600", flexShrink: 1 },
  when: { color: colors.textFaint, fontSize: 12 },
  meta: { color: colors.textMuted, fontSize: 14, marginTop: 3 },
  details: { color: colors.text, fontSize: 14, marginTop: 6, fontStyle: "italic" },
  resolution: { color: colors.primary, fontSize: 13, marginTop: 6 },
});
