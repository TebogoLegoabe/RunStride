import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="verify-identity" />
        <Stack.Screen name="running-preferences" />
        <Stack.Screen name="dating-preferences" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}
