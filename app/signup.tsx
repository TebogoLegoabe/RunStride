import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, sendOtp } from "../lib/api";
import { colors } from "../lib/theme";

export default function Signup() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await sendOtp(phone.trim());
      router.push({ pathname: "/verify", params: { phone: res.phone } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach RunStride. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = phone.trim().length > 0 && !loading;

  return (
    <View style={styles.container}>
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
