import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList } from "react-native";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ApiError, getReports } from "../../../lib/api";
import { formatWhen, labelFor } from "../../../lib/format";
import { REPORT_REASONS } from "../../../lib/options";
import type { ReportSummary } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { ChoiceChips } from "../../../components/ChoiceChips";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const VIEWS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
] as const;

// Admins only (the tab is hidden for everyone else, and the API refuses non-admins)
export default function ModerationQueue() {
  const router = useRouter();
  const { token } = useChat();
  const [view, setView] = useState<("open" | "resolved")[]>(["open"]);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setReports(await getReports(token, view[0]));
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
    <View style={styles.container}>
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

      {reports === null ? (
        <ActivityIndicator color="#4ecdc4" style={styles.spinner} />
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
  container: { flex: 1, backgroundColor: "#0f172a", paddingTop: 48 },
  inner: { paddingHorizontal: 16, maxWidth: 720, width: "100%", alignSelf: "center" },
  heading: { fontSize: 26, fontWeight: "700", color: "#ffffff", marginBottom: 12 },
  error: { color: "#f87171", fontSize: 14, marginBottom: 12 },
  spinner: { marginTop: 32 },
  empty: { color: "#94a3b8", fontSize: 15, textAlign: "center", marginTop: 32 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  reason: { color: "#ffffff", fontSize: 16, fontWeight: "600", flexShrink: 1 },
  when: { color: "#64748b", fontSize: 12 },
  meta: { color: "#94a3b8", fontSize: 14, marginTop: 3 },
  details: { color: "#cbd5e1", fontSize: 14, marginTop: 6, fontStyle: "italic" },
  resolution: { color: "#4ecdc4", fontSize: 13, marginTop: 6 },
});
