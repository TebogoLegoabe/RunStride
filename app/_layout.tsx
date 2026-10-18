import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { View, Pressable, StyleSheet } from "react-native";
import { Text } from "../components/ui/Text";
import { colors } from "../lib/theme";
import { installErrorReporting, reportError } from "../lib/errorReporting";

installErrorReporting();

// Keep the splash screen up until the brand font is ready, so text never jumps fonts
SplashScreen.preventAutoHideAsync().catch(() => {});

// Shown instead of a blank or broken screen when something goes wrong while drawing a page
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    reportError(error, true);
  }, [error]);
  return (
    <View style={errorStyles.wrap}>
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.body}>Sorry about that. We've been told about it automatically.</Text>
      <Pressable style={errorStyles.button} onPress={retry} accessibilityRole="button">
        <Text style={errorStyles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const errorStyles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { color: colors.heading, fontSize: 22, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15, textAlign: "center" },
  button: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28, marginTop: 8 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const ready = fontsLoaded || !!fontError; // if a font fails, carry on with the system font

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          // The brand background behind screens while they animate, instead of a white flash
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ animation: "fade" }} />
        <Stack.Screen name="signup" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="verify-identity" />
        <Stack.Screen name="running-preferences" />
        <Stack.Screen name="dating-preferences" />
        <Stack.Screen name="(app)" options={{ animation: "fade" }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
