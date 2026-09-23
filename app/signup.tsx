import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";

export default function Signup() {
  const router = useRouter();
  const [phone, setPhone] = useState("");

  const handleSendOtp = () => {
    // TODO: call POST /auth/otp/send on the backend
    router.push("/verify");
  };

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
        value={phone}
        onChangeText={setPhone}
      />

      <Pressable style={styles.primaryButton} onPress={handleSendOtp}>
        <Text style={styles.primaryButtonText}>Send Code</Text>
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
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
});
