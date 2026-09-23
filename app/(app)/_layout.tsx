import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { ApiError, getMe } from "../../lib/api";
import { routeFor } from "../../lib/routing";
import { clearToken, getToken } from "../../lib/session";
import { ChatProvider } from "../../components/ChatProvider";

// Layout for signed-in screens. Only users who finished onboarding get in; everyone
// else is sent to the step they're on. Tabs live in (tabs); chat opens on top of them.
export default function AppLayout() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

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
        if (e instanceof ApiError && e.status === 401) await clearToken();
        router.replace("/");
      }
    })();
  }, [router]);

  if (!allowed) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#4ecdc4" />
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
  loading: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
});
