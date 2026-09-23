import { View, Text, Pressable, StyleSheet } from "react-native";
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { ApiError, getMe } from "../lib/api";
import { routeFor } from "../lib/routing";
import { clearToken, getToken } from "../lib/session";

export default function Welcome() {
  const router = useRouter();

  // Already signed in: skip straight to wherever onboarding left off
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        router.replace(routeFor(await getMe(token)));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clearToken();
      }
    })();
  }, [router]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>RunStride</Text>
      <Text style={styles.subtitle}>Find someone who runs at your pace.</Text>

      <Pressable
        style={styles.primaryButton}
        onPress={() => router.push("/signup")}
      >
        <Text style={styles.primaryButtonText}>Get Started</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 40,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#94a3b8",
    marginBottom: 40,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "600",
  },
});
