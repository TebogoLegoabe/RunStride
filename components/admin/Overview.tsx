import { View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text } from "../ui/Text";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiError, getAdminStats } from "../../lib/api";
import type { AdminStats } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { colors, fonts, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

type Go = (section: "open" | "races" | "ids" | "people") => void;

function Stat({ label, value, hint, onPress }: { label: string; value: number; hint?: string; onPress?: () => void }) {
  const body = (
    <>
      <Text style={styles.value}>{value.toLocaleString()}</Text>
      <Text style={styles.label}>{label}</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </>
  );
  return onPress ? (
    <Pressable style={[styles.card, value > 0 && styles.cardAlert]} onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    <View style={styles.card}>{body}</View>
  );
}

// The numbers behind RunStride: who's here, who's active, and what needs a decision
export function Overview({ go }: { go: Go }) {
  const { token } = useChat();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setStats(await getAdminStats(token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, 30_000); // keeps "active now" fresh while you watch
      return () => clearInterval(id);
    }, [load])
  );

  if (!stats) return error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />;

  const peak = Math.max(1, ...stats.signupsByDay.map((d) => d.count));

  return (
    <View style={styles.wrap}>
      <Text style={styles.section}>Needs your decision</Text>
      <View style={styles.grid}>
        <Stat label="ID checks waiting" value={stats.pendingIdChecks} onPress={() => go("ids")} />
        <Stat label="Races to approve" value={stats.pendingRaces} onPress={() => go("races")} />
        <Stat label="Open reports" value={stats.openReports} onPress={() => go("open")} />
      </View>

      <Text style={styles.section}>People</Text>
      <View style={styles.grid}>
        <Stat label="Total users" value={stats.usersTotal} hint={`${stats.profilesComplete} with a profile`} onPress={() => go("people")} />
        <Stat label="New in 24 hours" value={stats.newToday} hint={`${stats.newWeek} this week`} />
        <Stat label="Plus members" value={stats.plusActive} />
        <Stat label="ID verified" value={stats.verified} />
        <Stat label="Google linked" value={stats.withGoogle} />
        <Stat label="Suspended or banned" value={stats.suspendedOrBanned} />
      </View>

      <Text style={styles.section}>Active users</Text>
      <View style={styles.grid}>
        <Stat label="Online now" value={stats.activeNow} hint="last 5 minutes" />
        <Stat label="Last 24 hours" value={stats.activeDay} />
        <Stat label="Last 7 days" value={stats.activeWeek} />
        <Stat label="Last 30 days" value={stats.activeMonth} />
      </View>

      <Text style={styles.section}>Activity</Text>
      <View style={styles.grid}>
        <Stat label="Matches" value={stats.matchesTotal} />
        <Stat label="Messages (24 hours)" value={stats.messagesDay} />
        <Stat label="Races published" value={stats.racesPublished} />
      </View>

      <Text style={styles.section}>Sign-ups, last 14 days</Text>
      <View style={styles.chart}>
        {stats.signupsByDay.map((d) => (
          <View key={d.day} style={styles.barCol}>
            <Text style={styles.barValue}>{d.count || ""}</Text>
            <View style={[styles.bar, { height: 6 + (d.count / peak) * 70 }]} />
            <Text style={styles.barDay}>{d.day.slice(8)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>
        Active means the app talked to the server. It's counted from when this update went live.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, maxWidth: 900, width: "100%", alignSelf: "center", paddingBottom: 40 },
  error: { color: colors.dangerText, fontSize: 14, margin: 16 },
  section: { color: colors.textMuted, fontSize: 12, fontFamily: fonts.bold, textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  cardAlert: { borderColor: colors.primary, backgroundColor: colors.primaryTintSoft },
  value: { color: colors.heading, fontSize: 28, fontFamily: fonts.bold },
  label: { color: colors.text, fontSize: 13, marginTop: 2 },
  hint: { color: colors.textFaint, fontSize: 12, marginTop: 2 },
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 110, backgroundColor: colors.surface, borderRadius: radius.md, padding: 10 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  bar: { width: "70%", borderRadius: 4, backgroundColor: colors.primary },
  barValue: { color: colors.textMuted, fontSize: 10, marginBottom: 2 },
  barDay: { color: colors.textFaint, fontSize: 10, marginTop: 3 },
  footnote: { color: colors.textFaint, fontSize: 12, marginTop: 10 },
});
