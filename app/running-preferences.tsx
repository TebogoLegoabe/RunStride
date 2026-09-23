import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, getMe, getRunningProfile, saveRunningProfile } from "../lib/api";
import { GOALS, RUN_TIMES, TERRAINS, type Goal, type RunTime, type Terrain } from "../lib/options";
import { routeFor } from "../lib/routing";
import { getToken } from "../lib/session";
import { ChoiceChips } from "../components/ChoiceChips";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const digits = (t: string) => t.replace(/\D/g, "");

export default function RunningPreferences() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [paceMin, setPaceMin] = useState("");
  const [paceSec, setPaceSec] = useState("");
  const [weeklyKm, setWeeklyKm] = useState("");
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [runTimes, setRunTimes] = useState<RunTime[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) {
        router.replace("/");
        return;
      }
      setToken(t);
      try {
        const existing = await getRunningProfile(t);
        if (existing) {
          setPaceMin(String(Math.floor(existing.paceSecondsPerKm / 60)));
          setPaceSec(String(existing.paceSecondsPerKm % 60).padStart(2, "0"));
          setWeeklyKm(String(existing.weeklyKm));
          setTerrains(existing.terrains);
          setGoals(existing.goals);
          setRunTimes(existing.runTimes);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      } finally {
        setInitializing(false);
      }
    })();
  }, [router]);

  const paceSeconds = Number(paceMin) * 60 + Number(paceSec || "0");

  const validate = (): string | null => {
    if (!paceMin || Number(paceSec || "0") > 59) return "Please enter your pace as minutes and seconds per km.";
    if (paceSeconds < 150 || paceSeconds > 1200) return "Pace should be between 2:30 and 20:00 per km.";
    if (!weeklyKm) return "Please enter roughly how far you run each week.";
    if (Number(weeklyKm) > 400) return "Weekly distance should be 400 km or less.";
    if (terrains.length === 0) return "Pick at least one place you like to run.";
    if (goals.length === 0) return "Pick at least one thing you're running for.";
    return null;
  };

  const handleSave = async () => {
    if (!token) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await saveRunningProfile(token, {
        paceSecondsPerKm: paceSeconds,
        weeklyKm: Number(weeklyKm),
        terrains,
        goals,
        runTimes,
      });
      router.replace(routeFor(await getMe(token)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  };

  if (initializing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#4ecdc4" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>How do you run?</Text>
      <Text style={styles.subtitle}>
        We use this to match you with people who'd enjoy running together. Strava sync is
        coming, so soon this can fill itself in.
      </Text>

      <Text style={styles.label}>Easy-run pace</Text>
      <Text style={styles.hint}>Your comfortable, can-still-chat pace.</Text>
      <View style={styles.inlineRow}>
        <TextInput
          style={[styles.input, styles.smallInput]}
          placeholder="5"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          value={paceMin}
          onChangeText={(t) => setPaceMin(digits(t))}
          accessibilityLabel="Pace minutes"
        />
        <Text style={styles.inlineText}>:</Text>
        <TextInput
          style={[styles.input, styles.smallInput]}
          placeholder="30"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          value={paceSec}
          onChangeText={(t) => setPaceSec(digits(t))}
          accessibilityLabel="Pace seconds"
        />
        <Text style={styles.inlineText}>min/km</Text>
      </View>

      <Text style={styles.label}>Weekly distance</Text>
      <View style={styles.inlineRow}>
        <TextInput
          style={[styles.input, styles.smallInput]}
          placeholder="20"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={3}
          value={weeklyKm}
          onChangeText={(t) => setWeeklyKm(digits(t))}
          accessibilityLabel="Kilometres per week"
        />
        <Text style={styles.inlineText}>km per week</Text>
      </View>

      <Text style={styles.label}>Where you like to run</Text>
      <ChoiceChips options={TERRAINS} selected={terrains} onChange={setTerrains} />

      <Text style={styles.label}>What you're running for</Text>
      <ChoiceChips options={GOALS} selected={goals} onChange={setGoals} />

      <Text style={styles.label}>When you usually run</Text>
      <Text style={styles.hint}>Optional</Text>
      <ChoiceChips options={RUN_TIMES} selected={runTimes} onChange={setRunTimes} />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.primaryButtonText}>Continue</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 24, paddingTop: 64, paddingBottom: 48, width: "100%", maxWidth: 560, alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "700", color: "#ffffff", marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, color: "#94a3b8", marginBottom: 32 },
  label: { fontSize: 15, fontWeight: "600", color: "#ffffff", marginBottom: 6 },
  hint: { fontSize: 13, color: "#94a3b8", marginBottom: 12 },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 24 },
  inlineText: { color: "#cbd5e1", fontSize: 16 },
  input: {
    backgroundColor: "#1e293b",
    color: "#ffffff",
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  smallInput: { width: 72, textAlign: "center" },
  error: { color: "#f87171", fontSize: 14, marginBottom: 16, textAlign: "center" },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
});
