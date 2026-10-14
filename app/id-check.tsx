import { View, Pressable, StyleSheet, ActivityIndicator, ScrollView, Image } from "react-native";
import { Text, TextInput } from "../components/ui/Text";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getIdCheck, submitIdCheck } from "../lib/api";
import { getToken } from "../lib/session";
import type { IdCheckState } from "../lib/types";
import { colors } from "../lib/theme";
import { useTopPadding } from "../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

// Optional: earns the verified badge. An ID number, a photo of the ID and a selfie, reviewed by a person.
export default function IdCheck() {
  const router = useRouter();
  const topPadding = useTopPadding();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<IdCheckState | null>(null);
  const [idNumber, setIdNumber] = useState("");
  const [idPhoto, setIdPhoto] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (t: string) => {
    try {
      setState(await getIdCheck(t));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) {
        router.replace("/");
        return;
      }
      setToken(t);
      await load(t);
    })();
  }, [router, load]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/discover"));

  const pick = async (camera: boolean, set: (uri: string) => void) => {
    setError(null);
    try {
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8 };
      if (camera) {
        const allowed = await ImagePicker.requestCameraPermissionsAsync();
        if (!allowed.granted) {
          setError("Allow the camera in your phone's settings, or choose a photo from your gallery.");
          return;
        }
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled) set(result.assets[0].uri);
    } catch {
      setError("Couldn't open the camera. Please try again, or choose a photo from your gallery.");
    }
  };

  const submit = async () => {
    if (!token || !idPhoto || !selfie) return;
    setBusy(true);
    setError(null);
    try {
      setState(await submitIdCheck(token, idNumber, idPhoto, selfie));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const ready = idNumber.replace(/\D/g, "").length === 13 && !!idPhoto && !!selfie && !busy;

  if (!state) {
    return (
      <View style={[styles.container, styles.center]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const done = (icon: keyof typeof Ionicons.glyphMap, title: string, body: string) => (
    <View style={[styles.container, styles.center, { paddingTop: topPadding }]}>
      <Ionicons name={icon} size={56} color={colors.primary} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <Pressable style={styles.primary} onPress={goBack}>
        <Text style={styles.primaryText}>Done</Text>
      </Pressable>
    </View>
  );

  if (!state.available) return done("time-outline", "Coming soon", "ID checks aren't open yet. We'll let you know.");
  if (state.status === "approved") return done("checkmark-circle", "You're verified", "Your ✓ badge now shows on your profile.");
  if (state.status === "pending")
    return done(
      "hourglass-outline",
      "We're checking your ID",
      "A person at RunStride is comparing your ID with your photos. It usually takes a day or two, and your ID photos are deleted as soon as we decide."
    );

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: topPadding }]}>
      <Text style={styles.title}>Get verified</Text>
      <Text style={styles.body}>
        Earn a ✓ badge so people know you're real. It's optional. Someone at RunStride compares your ID with your
        profile photos, then deletes your ID photos. We keep only a one-way fingerprint of your ID number, so the same
        ID can't be used for many accounts.
      </Text>

      {state.status === "rejected" && state.rejectReason && (
        <Text style={styles.warning}>Last time: {state.rejectReason}. You can try again.</Text>
      )}

      <Text style={styles.label}>Your South African ID number</Text>
      <TextInput
        style={styles.input}
        placeholder="13 digits"
        placeholderTextColor={colors.textFaint}
        keyboardType="number-pad"
        maxLength={16}
        value={idNumber}
        onChangeText={(t) => setIdNumber(t.replace(/[^\d ]/g, ""))}
      />

      <Text style={styles.label}>A photo of your ID (the side with your photo)</Text>
      <PickerRow uri={idPhoto} onCamera={() => pick(true, setIdPhoto)} onGallery={() => pick(false, setIdPhoto)} />

      <Text style={styles.label}>A selfie, in good light</Text>
      <PickerRow uri={selfie} onCamera={() => pick(true, setSelfie)} onGallery={() => pick(false, setSelfie)} />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable style={[styles.primary, !ready && styles.disabled]} onPress={submit} disabled={!ready}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Send for checking</Text>}
      </Pressable>
      <Pressable style={styles.link} onPress={goBack}>
        <Text style={styles.linkText}>Not now</Text>
      </Pressable>
      <Text style={styles.small}>
        By sending, you agree to us processing your ID details to check who you are, as set out in our privacy policy.
      </Text>
    </ScrollView>
  );
}

function PickerRow({ uri, onCamera, onGallery }: { uri: string | null; onCamera: () => void; onGallery: () => void }) {
  return (
    <View style={styles.pickerRow}>
      {uri ? <Image source={{ uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
      <View style={styles.pickerButtons}>
        <Pressable style={styles.outline} onPress={onCamera}>
          <Ionicons name="camera" size={18} color={colors.primary} />
          <Text style={styles.outlineText}>Take photo</Text>
        </Pressable>
        <Pressable style={styles.outline} onPress={onGallery}>
          <Ionicons name="image" size={18} color={colors.primary} />
          <Text style={styles.outlineText}>Choose</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  content: { padding: 20, paddingBottom: 40, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { color: colors.heading, fontSize: 26, fontWeight: "700", marginBottom: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 14 },
  label: { color: colors.heading, fontSize: 15, fontWeight: "600", marginTop: 14, marginBottom: 8 },
  input: {
    backgroundColor: colors.surface,
    color: colors.heading,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  thumb: { width: 96, height: 72, borderRadius: 10, backgroundColor: colors.surface },
  thumbEmpty: { borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed" },
  pickerButtons: { gap: 8 },
  outline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  outlineText: { color: colors.heading, fontSize: 14, fontWeight: "600" },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: "center",
    marginTop: 22,
  },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  link: { alignSelf: "center", padding: 12 },
  linkText: { color: colors.textMuted, fontSize: 15 },
  warning: { color: colors.warningText, fontSize: 14, marginBottom: 6 },
  error: { color: colors.dangerText, fontSize: 14, marginTop: 14 },
  small: { color: colors.textFaint, fontSize: 12, lineHeight: 17, textAlign: "center", marginTop: 6 },
});
