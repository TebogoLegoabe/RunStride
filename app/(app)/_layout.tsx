import { Stack } from "expo-router";

// Layout for signed-in screens. Becomes the tab bar (Discover, Chats, Profile)
// once those screens exist.
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
