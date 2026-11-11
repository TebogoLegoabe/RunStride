import { View, Pressable, StyleSheet, ActivityIndicator, ScrollView, Switch } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text, TextInput } from "../components/ui/Text";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, getDatingPreferences, getMe, getMyProfile, saveDatingPreferences, setDatingMode } from "../lib/api";
import { DISTANCES_KM, GENDERS, SHOW_ME, distanceLabel, type Gender } from "../lib/options";
import { afterSave } from "../lib/routing";
import { getToken } from "../lib/session";
import { ChoiceChips } from "../components/ChoiceChips";
import { colors, setThemePreference, themePreference, type ThemePreference } from "../lib/theme";
import { useBottomPadding, useTopPadding } from "../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Match my phone" },
];
const DISTANCE_OPTIONS = DISTANCES_KM.map((km) => ({ value: String(km), label: distanceLabel(km) }));
const digits = (t: string) => t.replace(/\D/g, "");

export default function DatingPreferencesScreen() {
  const topPadding = useTopPadding();
  const bottomPadding = useBottomPadding(48);
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [gender, setGender] = useState<Gender[]>([]);
  const [interestedIn, setInterestedIn] = useState<Gender[]>([]);
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [distance, setDistance] = useState<string[]>(["100"]);
  const [saving, setSaving] = useState(false);
  // First time through only: be findable on Discover and in race runner lists (Profile changes it later)
  const [findable, setFindable] = useState(true);
  // First time through: pick a look. Switching reloads the app, so it's applied on Finish.
  const [theme, setTheme] = useState<ThemePreference[]>([themePreference]);
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
      if (edit !== "1" && !findable) await setDatingMode(token, "taken");
      afterSave(router, await getMe(token), edit === "1");
      // A new look reloads the app, which then opens where afterSave just went
      if (edit !== "1" && theme[0] !== themePreference) setThemePreference(theme[0]).catch(() => {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  };

  if (initializing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: topPadding, paddingBottom: bottomPadding }]}>
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
          placeholderTextColor={colors.textFaint}
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
          placeholderTextColor={colors.textFaint}
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

      {edit !== "1" && (
        <View style={styles.findable}>
          <Ionicons name={findable ? "eye-outline" : "eye-off-outline"} size={22} color={colors.primary} />
          <View style={styles.findableText}>
            <Text style={styles.findableTitle}>Let runners find me</Text>
            <Text style={styles.findableBody}>
              {findable
                ? "You'll show up on Discover and in race runner lists. Here just for races and race chats, or seeing someone? Turn this off. You can change it any time in Profile."
                : "You'll stay hidden from Discover and race runner lists. You can still join races, chat in race groups and swap entries. Turn it on any time in Profile."}
            </Text>
          </View>
          <Switch
            value={findable}
            onValueChange={setFindable}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.onAccent}
            accessibilityLabel="Let runners find me on Discover and in race runner lists"
          />
        </View>
      )}

      {edit !== "1" && (
        <>
          <Text style={styles.label}>Look</Text>
          <Text style={styles.hint}>Applied when you finish. Change it any time in Profile → Appearance.</Text>
          <ChoiceChips options={THEMES} selected={theme} onChange={(v) => v.length && setTheme(v)} single />
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.primaryButton, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.primaryButtonText}>{edit === "1" ? "Save" : findable ? "Start discovering" : "Finish"}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 24, width: "100%", maxWidth: 560, alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "700", color: colors.heading, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 32 },
  label: { fontSize: 15, fontWeight: "600", color: colors.heading, marginBottom: 10 },
  hint: { fontSize: 13, color: colors.textMuted, marginTop: -4, marginBottom: 12 },
  findable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    marginTop: 8,
    marginBottom: 20,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  findableText: { flex: 1 },
  findableTitle: { color: colors.heading, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  findableBody: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 24 },
  inlineText: { color: colors.text, fontSize: 16 },
  input: {
    backgroundColor: colors.surface,
    color: colors.heading,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
  },
  smallInput: { width: 72, textAlign: "center" },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 16, textAlign: "center" },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
});
