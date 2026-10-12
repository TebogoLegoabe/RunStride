import { Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text, TextInput } from "../components/ui/Text";
import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ApiError, getMe, sendOtp, verifyOtp } from "../lib/api";
import { routeFor } from "../lib/routing";
import { saveDeviceToken, saveToken } from "../lib/session";
import { colors } from "../lib/theme";
import { AuthCard } from "../components/ui/AuthCard";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

export default function Verify() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Each code is a paid text message: wait a minute before asking for another
  const RESEND_SECONDS = 60;
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const handleVerify = async () => {
    if (!phone) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await verifyOtp(phone, code);
      await saveToken(res.token);
      if (res.deviceToken) await saveDeviceToken(res.deviceToken);
      router.replace(routeFor(await getMe(res.token)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!phone || wait > 0) return;
    setError(null);
    setNotice(null);
    try {
      await sendOtp(phone);
      setNotice("New code sent.");
      setWait(RESEND_SECONDS);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  if (!phone) {
    return (
      <AuthCard>
        <Text style={styles.title}>Something went wrong</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace("/signup")}>
          <Text style={styles.primaryButtonText}>Start again</Text>
        </Pressable>
      </AuthCard>
    );
  }

  const canSubmit = code.length === 6 && !loading;

  // Autofilled from the text message (or typed): no need to press a button
  useEffect(() => {
    if (code.length === 6 && !loading) handleVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <AuthCard>
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

      <Pressable style={styles.linkButton} onPress={handleResend} disabled={wait > 0}>
        <Text style={[styles.linkText, wait > 0 && styles.linkWaiting]}>
          {wait > 0 ? `Didn't get it? Resend in ${wait}s` : "Didn't get it? Resend code"}
        </Text>
      </Pressable>
    </AuthCard>
  );
}

const styles = StyleSheet.create({
  linkWaiting: { opacity: 0.5 },
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
