import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, sendOtp } from "../lib/api";

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
        placeholderTextColor="#64748b"
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
          <ActivityIndicator color="#0f172a" />
        ) : (
          <Text style={styles.primaryButtonText}>Send Code</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 24, justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "700", color: "#ffffff", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 32 },
  input: {
    backgroundColor: "#1e293b",
    color: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    fontSize: 16,
  },
  error: { color: "#f87171", fontSize: 14, marginTop: -8, marginBottom: 16 },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
});
