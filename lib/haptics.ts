// Small vibrations for key moments. Silently does nothing where unsupported (web, simulators).
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

function safely(run: () => Promise<void>) {
  if (Platform.OS === "web") return;
  run().catch(() => {});
}

export const haptics = {
  tap: () => safely(() => Haptics.selectionAsync()),
  like: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  pass: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
