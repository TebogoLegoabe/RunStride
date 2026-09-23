import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView, Image } from "react-native";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getReport, mediaUrl, resolveReport } from "../../../lib/api";
import { formatWhen, labelFor } from "../../../lib/format";
import { REPORT_REASONS } from "../../../lib/options";
import type { ModerationAction, ReportDetail } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { ChoiceChips } from "../../../components/ChoiceChips";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const SUSPEND_OPTIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
];

export default function ReportReview() {
  const router = useRouter();
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const { token } = useChat();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [note, setNote] = useState("");
  const [suspendDays, setSuspendDays] = useState<string[]>(["7"]);
  const [confirmBan, setConfirmBan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getReport(token, reportId)
      .then(setReport)
      .catch((e) => setError(e instanceof ApiError ? e.message : NETWORK_ERROR));
  }, [token, reportId]);

  const resolve = async (action: ModerationAction) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setReport(
        await resolveReport(token, reportId, {
          action,
          note: note.trim() || undefined,
          suspendDays: action === "suspend" ? Number(suspendDays[0]) : undefined,
        })
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
      setConfirmBan(false);
    }
  };

  if (!report) {
    return (
      <View style={[styles.container, styles.centered]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color="#4ecdc4" />}
      </View>
    );
  }

  const { evidence, reported } = report;
  const open = report.status === "open";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color="#e2e8f0" />
        <Text style={styles.backText}>Queue</Text>
      </Pressable>

      <Text style={styles.title}>{labelFor(REPORT_REASONS, report.reason)}</Text>
      <Text style={styles.meta}>
        Reported {formatWhen(report.createdAt)} by {report.reporter.displayName ?? "a deleted account"}
      </Text>
      {report.details && <Text style={styles.details}>“{report.details}”</Text>}

      <Text style={styles.section}>Reported account</Text>
      <View style={styles.box}>
        <Text style={styles.boxTitle}>{reported.displayName ?? "Account deleted"}</Text>
        <Text style={styles.meta}>
          Status: {reported.accountStatus ?? "deleted"} · {reported.openReportCount} open /{" "}
          {reported.totalReportCount} total reports
        </Text>
      </View>

      <Text style={styles.section}>Profile when reported</Text>
      <View style={styles.box}>
        <View style={styles.photos}>
          {evidence.profile.photos.map((url) => (
            <Image key={url} source={{ uri: mediaUrl(url) }} style={styles.photo} />
          ))}
        </View>
        <Text style={styles.boxTitle}>{evidence.profile.displayName}</Text>
        {evidence.profile.bio && <Text style={styles.bio}>{evidence.profile.bio}</Text>}
      </View>

      <Text style={styles.section}>Conversation ({evidence.messages.length} messages)</Text>
      <View style={styles.box}>
        {evidence.messages.length === 0 ? (
          <Text style={styles.meta}>They never messaged each other.</Text>
        ) : (
          evidence.messages.map((m, i) => (
            <View key={i} style={[styles.msg, m.fromReported ? styles.msgReported : styles.msgReporter]}>
              <Text style={styles.msgWho}>
                {m.fromReported ? "Reported" : "Reporter"} · {formatWhen(m.createdAt)}
              </Text>
              <Text style={styles.msgBody}>{m.body}</Text>
            </View>
          ))
        )}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {open ? (
        <>
          <Text style={styles.section}>Decision</Text>
          <TextInput
            style={styles.input}
            placeholder="Note for the record (optional)"
            placeholderTextColor="#64748b"
            multiline
            maxLength={1000}
            value={note}
            onChangeText={setNote}
          />
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => resolve("dismiss")} disabled={busy}>
              <Text style={styles.actionText}>Dismiss</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => resolve("warn")} disabled={busy}>
              <Text style={styles.actionText}>Warn</Text>
            </Pressable>
          </View>

          {reported.id && (
            <>
              <Text style={styles.label}>Suspend for</Text>
              <ChoiceChips options={SUSPEND_OPTIONS} selected={suspendDays} onChange={setSuspendDays} single />
              <Pressable style={[styles.action, styles.warnAction]} onPress={() => resolve("suspend")} disabled={busy}>
                <Text style={styles.warnText}>Suspend {suspendDays[0]} day{suspendDays[0] === "1" ? "" : "s"}</Text>
              </Pressable>
              {confirmBan ? (
                <Pressable style={[styles.action, styles.banAction]} onPress={() => resolve("ban")} disabled={busy}>
                  <Text style={styles.banText}>Confirm permanent ban</Text>
                </Pressable>
              ) : (
                <Pressable style={[styles.action, styles.banOutline]} onPress={() => setConfirmBan(true)}>
                  <Text style={styles.banOutlineText}>Ban…</Text>
                </Pressable>
              )}
            </>
          )}
          {busy && <ActivityIndicator color="#4ecdc4" style={styles.spinner} />}
        </>
      ) : (
        <View style={[styles.box, styles.resolvedBox]}>
          <Text style={styles.boxTitle}>Resolved: {report.resolution}</Text>
          {report.resolvedAt && <Text style={styles.meta}>{formatWhen(report.resolvedAt)}</Text>}
          {report.resolutionNote && <Text style={styles.bio}>{report.resolutionNote}</Text>}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingTop: 44, paddingBottom: 48, maxWidth: 720, width: "100%", alignSelf: "center" },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { color: "#e2e8f0", fontSize: 16 },
  title: { color: "#ffffff", fontSize: 24, fontWeight: "700", marginBottom: 4 },
  meta: { color: "#94a3b8", fontSize: 14 },
  details: { color: "#e2e8f0", fontSize: 15, lineHeight: 22, marginTop: 10, fontStyle: "italic" },
  section: { color: "#ffffff", fontSize: 16, fontWeight: "700", marginTop: 24, marginBottom: 8 },
  box: { backgroundColor: "#1e293b", borderRadius: 12, padding: 14 },
  resolvedBox: { marginTop: 24 },
  boxTitle: { color: "#ffffff", fontSize: 16, fontWeight: "600", marginBottom: 4 },
  bio: { color: "#cbd5e1", fontSize: 14, lineHeight: 20, marginTop: 4 },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  photo: { width: 72, height: 90, borderRadius: 8, backgroundColor: "#334155" },
  msg: { borderRadius: 10, padding: 10, marginBottom: 6, maxWidth: "85%" },
  msgReported: { backgroundColor: "rgba(239, 68, 68, 0.15)", alignSelf: "flex-start" },
  msgReporter: { backgroundColor: "#334155", alignSelf: "flex-end" },
  msgWho: { color: "#94a3b8", fontSize: 11, marginBottom: 2 },
  msgBody: { color: "#e2e8f0", fontSize: 14, lineHeight: 20 },
  error: { color: "#f87171", fontSize: 14, marginTop: 16, textAlign: "center" },
  input: {
    backgroundColor: "#1e293b",
    color: "#ffffff",
    borderRadius: 12,
    padding: 14,
    minHeight: 70,
    textAlignVertical: "top",
    fontSize: 15,
    marginBottom: 12,
  },
  label: { color: "#ffffff", fontSize: 15, fontWeight: "600", marginTop: 12, marginBottom: 10 },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#475569",
    marginBottom: 8,
  },
  actionText: { color: "#e2e8f0", fontSize: 15, fontWeight: "600" },
  warnAction: { borderColor: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.12)", marginTop: -8 },
  warnText: { color: "#fbbf24", fontSize: 15, fontWeight: "600" },
  banOutline: { borderColor: "#ef4444" },
  banOutlineText: { color: "#f87171", fontSize: 15, fontWeight: "600" },
  banAction: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  banText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  spinner: { marginTop: 12 },
});
