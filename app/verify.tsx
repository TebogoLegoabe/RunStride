import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";

export default function Verify() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const handleVerify = () => {
    // TODO: call POST /auth/otp/verify, then kick off ID verification
    // (Onfido/Persona SDK flow) before routing into the main app
    router.push("/(app)");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter your code</Text>

      <TextInput
        style={styles.input}
        placeholder="6-digit code"
        placeholderTextColor="#64748b"
        keyboardType="number-pad"
        value={code}
        onChangeText={setCode}
        maxLength={6}
      />

      <Pressable style={styles.primaryButton} onPress={handleVerify}>
        <Text style={styles.primaryButtonText}>Verify</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", padding: 24, justifyContent: "center" },
  title: { fontSize: 26, fontWeight: "700", color: "#ffffff", marginBottom: 32 },
  input: {
    backgroundColor: "#1e293b",
    color: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    fontSize: 20,
    textAlign: "center",
    letterSpacing: 8,
  },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
});
