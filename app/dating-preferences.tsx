import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, getDatingPreferences, getMe, getMyProfile, saveDatingPreferences } from "../lib/api";
import { DISTANCES_KM, GENDERS, SHOW_ME, type Gender } from "../lib/options";
import { routeFor } from "../lib/routing";
import { getToken } from "../lib/session";
import { ChoiceChips } from "../components/ChoiceChips";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const DISTANCE_OPTIONS = DISTANCES_KM.map((km) => ({ value: String(km), label: `${km} km` }));
const digits = (t: string) => t.replace(/\D/g, "");

export default function DatingPreferencesScreen() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [gender, setGender] = useState<Gender[]>([]);
  const [interestedIn, setInterestedIn] = useState<Gender[]>([]);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [distance, setDistance] = useState<string[]>(["25"]);
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
        const existing = await getDatingPreferences(t);
        if (existing) {
          setGender([existing.gender]);
          setInterestedIn(existing.interestedIn);
          setAgeMin(String(existing.ageMin));
          setAgeMax(String(existing.ageMax));
          setDistance([String(existing.maxDistanceKm)]);
        } else {
          // Start with an age range around the user's own age
          const profile = await getMyProfile(t);
          if (profile) {
            setAgeMin(String(Math.max(18, profile.age - 5)));
            setAgeMax(String(Math.min(99, profile.age + 5)));
          }
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      } finally {
        setInitializing(false);
      }
    })();
  }, [router]);

  const validate = (): string | null => {
    if (gender.length === 0) return "Please choose how you identify.";
    if (interestedIn.length === 0) return "Please choose who you'd like to meet.";
    const min = Number(ageMin), max = Number(ageMax);
    if (!ageMin || !ageMax) return "Please enter an age range.";
    if (min < 18 || max > 99) return "Ages must be between 18 and 99.";
    if (min > max) return "Minimum age can't be higher than maximum age.";
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
      await saveDatingPreferences(token, {
        gender: gender[0],
        interestedIn,
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
        maxDistanceKm: Number(distance[0]),
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
      <Text style={styles.title}>Who would you like to meet?</Text>
      <Text style={styles.subtitle}>You can change these any time.</Text>

      <Text style={styles.label}>I am a</Text>
      <ChoiceChips options={GENDERS} selected={gender} onChange={setGender} single />

      <Text style={styles.label}>Show me</Text>
      <ChoiceChips options={SHOW_ME} selected={interestedIn} onChange={setInterestedIn} />

      <Text style={styles.label}>Age range</Text>
      <View style={styles.inlineRow}>
        <TextInput
          style={[styles.input, styles.smallInput]}
          placeholder="18"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          value={ageMin}
          onChangeText={(t) => setAgeMin(digits(t))}
          accessibilityLabel="Minimum age"
        />
        <Text style={styles.inlineText}>to</Text>
        <TextInput
          style={[styles.input, styles.smallInput]}
          placeholder="99"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          value={ageMax}
          onChangeText={(t) => setAgeMax(digits(t))}
          accessibilityLabel="Maximum age"
        />
      </View>

      <Text style={styles.label}>Maximum distance</Text>
      <Text style={styles.hint}>How far you'd travel to meet for a run.</Text>
      <ChoiceChips options={DISTANCE_OPTIONS} selected={distance} onChange={setDistance} single />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.primaryButtonText}>Start discovering</Text>
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
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 32 },
  label: { fontSize: 15, fontWeight: "600", color: "#ffffff", marginBottom: 10 },
  hint: { fontSize: 13, color: "#94a3b8", marginTop: -4, marginBottom: 12 },
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
