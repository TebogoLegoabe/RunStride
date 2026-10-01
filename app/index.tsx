import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { ApiError, getMe } from "../lib/api";
import { routeFor } from "../lib/routing";
import { clearToken, getToken } from "../lib/session";
import { colors } from "../lib/theme";

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
        // Suspended or banned: the signed-in area explains why
        if (e instanceof ApiError && e.status === 403) router.replace("/discover");
      }
    })();
  }, [router]);

  return (
    <View style={styles.container}>
      <Image
        source={require("../assets/logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="RunStride"
      />
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
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  // The logo art is 364x343; keep that shape
  logo: { width: 240, height: 226, marginBottom: 20 },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 40,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: "600",
  },
});
