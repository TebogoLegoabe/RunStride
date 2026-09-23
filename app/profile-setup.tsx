import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Image,
} from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  ApiError,
  deletePhoto,
  getMe,
  getMyProfile,
  mediaUrl,
  saveMyProfile,
  uploadPhoto,
} from "../lib/api";
import { routeFor } from "../lib/routing";
import { getToken } from "../lib/session";
import type { Photo } from "../lib/types";

const MAX_PHOTOS = 6;
const MAX_BIO = 500;
const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

// A photo on screen: picked locally, and `photo` once it's been uploaded
type Slot = { key: string; uri: string; photo?: Photo };

const pad = (n: string) => n.padStart(2, "0");

function ageFrom(birth: Date, today = new Date()): number {
  const hadBirthday =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  return today.getFullYear() - birth.getFullYear() - (hadBirthday ? 0 : 1);
}

// Returns YYYY-MM-DD, or null if the parts don't form a real date (e.g. 31/02)
function toIsoDate(day: string, month: string, year: string): string | null {
  const d = Number(day), m = Number(month), y = Number(year);
  if (!d || !m || year.length !== 4) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export default function ProfileSetup() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the token and any profile saved earlier (e.g. an interrupted setup)
  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) {
        router.replace("/signup");
        return;
      }
      setToken(t);
      try {
        const existing = await getMyProfile(t);
        if (existing) {
          const [y, m, d] = existing.birthDate.split("-");
          setName(existing.displayName);
          setDay(d);
          setMonth(m);
          setYear(y);
          setBio(existing.bio ?? "");
          setSlots(existing.photos.map((p) => ({ key: p.id, uri: mediaUrl(p.url), photo: p })));
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      } finally {
        setInitializing(false);
      }
    })();
  }, [router]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setSlots((current) => [...current, { key: `${Date.now()}`, uri }]);
  };

  const removePhoto = async (slot: Slot) => {
    setError(null);
    if (slot.photo && token) {
      try {
        await deletePhoto(token, slot.photo.id);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
        return;
      }
    }
    setSlots((current) => current.filter((s) => s.key !== slot.key));
  };

  const validate = (): string | null => {
    if (slots.length === 0) return "Add at least one photo.";
    if (!name.trim()) return "Please enter your name.";
    const iso = toIsoDate(day, month, year);
    if (!iso) return "Please enter a valid date of birth.";
    // Built from parts: new Date("YYYY-MM-DD") would parse as UTC and can shift the day
    if (ageFrom(new Date(Number(year), Number(month) - 1, Number(day))) < 18) return "You must be 18 or older to use RunStride.";
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
      await saveMyProfile(token, {
        displayName: name.trim(),
        birthDate: toIsoDate(day, month, year)!,
        bio: bio.trim(),
      });
      // Upload one at a time so photo order is kept. Already-uploaded photos are
      // skipped, so if one fails, tapping Continue again picks up where it stopped.
      for (const slot of slots) {
        if (slot.photo) continue;
        const photo = await uploadPhoto(token, slot.uri);
        setSlots((current) => current.map((s) => (s.key === slot.key ? { ...s, photo } : s)));
      }
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
      <Text style={styles.title}>Create your profile</Text>
      <Text style={styles.subtitle}>This is what other runners will see.</Text>

      <Text style={styles.label}>Photos</Text>
      <Text style={styles.hint}>Add up to {MAX_PHOTOS}. The first one is your main photo.</Text>
      <View style={styles.photoGrid}>
        {slots.map((slot, index) => (
          <View key={slot.key} style={styles.photoSlot}>
            <Image source={{ uri: slot.uri }} style={styles.photo} />
            {index === 0 && <Text style={styles.mainBadge}>Main</Text>}
            <Pressable
              style={styles.removeButton}
              onPress={() => removePhoto(slot)}
              disabled={saving}
              accessibilityLabel="Remove photo"
            >
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          </View>
        ))}
        {slots.length < MAX_PHOTOS && (
          <Pressable
            style={[styles.photoSlot, styles.addSlot]}
            onPress={pickPhoto}
            disabled={saving}
            accessibilityLabel="Add photo"
          >
            <Text style={styles.addText}>+</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.label}>First name</Text>
      <TextInput
        style={styles.input}
        placeholder="What should people call you?"
        placeholderTextColor="#64748b"
        autoComplete="given-name"
        maxLength={50}
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Date of birth</Text>
      <Text style={styles.hint}>Only your age is shown on your profile.</Text>
      <View style={styles.dateRow}>
        <TextInput
          style={[styles.input, styles.dateInput]}
          placeholder="DD"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          value={day}
          onChangeText={(t) => setDay(t.replace(/\D/g, ""))}
        />
        <TextInput
          style={[styles.input, styles.dateInput]}
          placeholder="MM"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={2}
          value={month}
          onChangeText={(t) => setMonth(t.replace(/\D/g, ""))}
        />
        <TextInput
          style={[styles.input, styles.yearInput]}
          placeholder="YYYY"
          placeholderTextColor="#64748b"
          keyboardType="number-pad"
          maxLength={4}
          value={year}
          onChangeText={(t) => setYear(t.replace(/\D/g, ""))}
        />
      </View>

      <Text style={styles.label}>About you</Text>
      <TextInput
        style={[styles.input, styles.bioInput]}
        placeholder="Favourite route, next race, why you run..."
        placeholderTextColor="#64748b"
        multiline
        maxLength={MAX_BIO}
        value={bio}
        onChangeText={setBio}
      />
      <Text style={styles.counter}>
        {bio.length}/{MAX_BIO}
      </Text>

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
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 32 },
  label: { fontSize: 15, fontWeight: "600", color: "#ffffff", marginBottom: 6 },
  hint: { fontSize: 13, color: "#94a3b8", marginBottom: 12 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 28 },
  photoSlot: {
    width: "31%",
    aspectRatio: 4 / 5,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1e293b",
  },
  photo: { width: "100%", height: "100%" },
  mainBadge: {
    position: "absolute",
    left: 6,
    bottom: 6,
    backgroundColor: "#4ecdc4",
    color: "#0f172a",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  removeButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: { color: "#ffffff", fontSize: 13 },
  addSlot: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#475569",
  },
  addText: { color: "#4ecdc4", fontSize: 32, fontWeight: "300" },
  input: {
    backgroundColor: "#1e293b",
    color: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    fontSize: 16,
  },
  dateRow: { flexDirection: "row", gap: 10 },
  dateInput: { width: 72, textAlign: "center" },
  yearInput: { width: 96, textAlign: "center" },
  bioInput: { minHeight: 110, textAlignVertical: "top", marginBottom: 6 },
  counter: { color: "#64748b", fontSize: 12, textAlign: "right", marginBottom: 24 },
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
