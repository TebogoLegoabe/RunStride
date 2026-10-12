import { Pressable, StyleSheet, ActivityIndicator, View } from "react-native";
import { Text, TextInput } from "../components/ui/Text";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, deviceSignIn, getMe, sendOtp } from "../lib/api";
import { routeFor } from "../lib/routing";
import { clearDeviceToken, getDeviceToken, saveDeviceToken, saveToken } from "../lib/session";
import { colors } from "../lib/theme";
import { AuthCard } from "../components/ui/AuthCard";
import { GoogleButton, googleAvailable } from "../components/GoogleButton";
import { finishGoogleSignIn } from "../lib/googleSignIn";

export default function Signup() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      // A phone we remember signs straight back in, with no text message
      const remembered = await getDeviceToken();
      if (remembered) {
        try {
          const res = await deviceSignIn(phone.trim(), remembered);
          await saveToken(res.token);
          if (res.deviceToken) await saveDeviceToken(res.deviceToken);
          router.replace(routeFor(await getMe(res.token)));
          return;
        } catch (e) {
          // Expired, or a different number: fall through to a normal code
          if (!(e instanceof ApiError) || e.status !== 401) throw e;
          await clearDeviceToken();
        }
      }
      const res = await sendOtp(phone.trim());
      router.push({ pathname: "/verify", params: { phone: res.phone } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach RunStride. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = phone.trim().length > 0 && !loading;

  const withGoogle = async (idToken: string) => {
    setError(null);
    setLoading(true);
    try {
      await finishGoogleSignIn(router, idToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach RunStride. Check your connection.");
      setLoading(false);
    }
  };

  return (
    <AuthCard>
      <Text style={styles.title}>Let's get you verified</Text>
      <Text style={styles.subtitle}>
        We'll text you a code to confirm your number.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Phone number"
        placeholderTextColor={colors.textFaint}
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
        onSubmitEditing={canSubmit ? handleSendOtp : undefined}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
        onPress={handleSendOtp}
        disabled={!canSubmit}
      >
        {loading ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.primaryButtonText}>Send Code</Text>
        )}
      </Pressable>

      {googleAvailable() && (
        <>
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>or</Text>
            <View style={styles.orLine} />
          </View>
          <GoogleButton busy={loading} onIdToken={withGoogle} onError={setError} />
        </>
      )}
    </AuthCard>
  );
}

const styles = StyleSheet.create({
  orRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 18 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.textFaint, fontSize: 13 },
  title: { fontSize: 26, fontWeight: "700", color: colors.heading, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 32 },
  input: {
    backgroundColor: colors.surface,
    color: colors.heading,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    fontSize: 16,
  },
  error: { color: colors.dangerText, fontSize: 14, marginTop: -8, marginBottom: 16 },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
});
