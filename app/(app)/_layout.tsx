import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Text } from "../../components/ui/Text";
import { ApiError, getMe } from "../../lib/api";
import { routeFor } from "../../lib/routing";
import { clearToken, getToken } from "../../lib/session";
import { ChatProvider } from "../../components/ChatProvider";
import { colors } from "../../lib/theme";

// Layout for signed-in screens. Only users who finished onboarding get in; everyone
// else is sent to the step they're on. Tabs live in (tabs); chat opens on top of them.
export default function AppLayout() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  // Why a suspended or banned account can't get in
  const [locked, setLocked] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        router.replace("/");
        return;
      }
      try {
        const next = routeFor(await getMe(token));
        if (next === "/discover") setAllowed(true);
        else router.replace(next);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setLocked(e.message);
          return;
        }
        if (e instanceof ApiError && e.status === 401) await clearToken();
        router.replace("/");
      }
    })();
  }, [router]);

  if (locked) {
    return (
      <View style={styles.loading}>
        <View style={styles.lockedBox}>
          <Text style={styles.lockedTitle}>Account unavailable</Text>
          <Text style={styles.lockedBody}>{locked}</Text>
          <Pressable
            style={styles.button}
            onPress={async () => {
              await clearToken();
              router.replace("/");
            }}
          >
            <Text style={styles.buttonText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <ChatProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ChatProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  lockedBox: { padding: 24, maxWidth: 420, width: "100%" },
  lockedTitle: { color: colors.heading, fontSize: 24, fontWeight: "700", marginBottom: 10 },
  lockedBody: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 24 },
  button: { borderColor: colors.primary, borderWidth: 1, paddingVertical: 13, borderRadius: 999, alignItems: "center" },
  buttonText: { color: colors.primary, fontSize: 16, fontWeight: "600" },
});
