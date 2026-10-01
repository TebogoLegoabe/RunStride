import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, getMe, sendOtp, verifyOtp } from "../lib/api";
import { routeFor } from "../lib/routing";
import { saveToken } from "../lib/session";
import { colors } from "../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

export default function Verify() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleVerify = async () => {
    if (!phone) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code);
      await saveToken(res.token);
      router.replace(routeFor(await getMe(res.token)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!phone) return;
    setError(null);
    setNotice(null);
    try {
      await sendOtp(phone);
      setNotice("New code sent.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  if (!phone) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace("/signup")}>
          <Text style={styles.primaryButtonText}>Start again</Text>
        </Pressable>
      </View>
    );
  }

  const canSubmit = code.length === 6 && !loading;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter your code</Text>
      <Text style={styles.subtitle}>Sent to {phone}</Text>

      <TextInput
        style={styles.input}
        placeholder="6-digit code"
        placeholderTextColor={colors.textFaint}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, ""))}
        maxLength={6}
        onSubmitEditing={canSubmit ? handleVerify : undefined}
      />

      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <Pressable
        style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={!canSubmit}
      >
        {loading ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.primaryButtonText}>Verify</Text>
        )}
      </Pressable>

      <Pressable style={styles.linkButton} onPress={handleResend}>
        <Text style={styles.linkText}>Didn't get it? Resend code</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "700", color: colors.heading, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 32 },
  input: {
    backgroundColor: colors.surface,
    color: colors.heading,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    fontSize: 20,
    textAlign: "center",
    letterSpacing: 8,
  },
  error: { color: colors.dangerText, fontSize: 14, marginTop: -8, marginBottom: 16, textAlign: "center" },
  notice: { color: colors.primary, fontSize: 14, marginTop: -8, marginBottom: 16, textAlign: "center" },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
  linkButton: { marginTop: 20, alignItems: "center" },
  linkText: { color: colors.textMuted, fontSize: 14 },
});
