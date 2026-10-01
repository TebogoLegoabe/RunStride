import { View, StyleSheet, Pressable, ActivityIndicator, FlatList, ScrollView } from "react-native";
import { Text } from "../../../components/ui/Text";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, getReports } from "../../../lib/api";
import { formatWhen, labelFor } from "../../../lib/format";
import { REPORT_REASONS } from "../../../lib/options";
import type { ReportSummary } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { ChoiceChips } from "../../../components/ChoiceChips";
import { RaceAdmin } from "../../../components/admin/RaceAdmin";
import { colors } from "../../../lib/theme";
import { useTopPadding } from "../../../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const VIEWS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "races", label: "Races" },
] as const;

// Admins only (the tab is hidden for everyone else, and the API refuses non-admins)
export default function ModerationQueue() {
  const topPadding = useTopPadding();
  const router = useRouter();
  const { token } = useChat();
  const [view, setView] = useState<("open" | "resolved" | "races")[]>(["open"]);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token || view[0] === "races") return;
    const status = view[0];
    try {
      setReports(await getReports(token, status));
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
        <Text style={styles.heading}>Moderation</Text>
        <ChoiceChips
          options={VIEWS}
          selected={view}
          onChange={(v) => {
            setReports(null);
            setView(v);
          }}
          single
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {view[0] === "races" ? (
        <ScrollView>
          <RaceAdmin />
        </ScrollView>
      ) : reports === null ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
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
