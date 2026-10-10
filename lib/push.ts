// Push notifications on phones (Expo's push service delivers to Apple and Google).
// lib/push.web.ts is the web version: browsers don't get push from RunStride.
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { registerPushToken, removePushToken } from "./api";

const TOKEN_KEY = "runstride.pushToken";

// While RunStride is open, the app itself shows new messages and alerts, so no banner then.
// Notifications still go to the notification list.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushSupport = "ok" | "web" | "simulator" | "expo-go" | "not-configured";

// Expo's push service needs the app's EAS project ID (set by `eas init`)
const projectId: string | undefined =
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

export function pushSupport(): PushSupport {
  if (!Device.isDevice) return "simulator";
  // Expo Go can't receive push notifications for other apps; a development build can
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return "expo-go";
  if (!projectId) return "not-configured";
  return "ok";
}

// Asks permission the first time, then tells the server where to send this account's pushes.
// Returns why not, when it can't.
export async function registerForPush(apiToken: string): Promise<PushSupport | "denied"> {
  const support = pushSupport();
  if (support !== "ok") return support;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "RunStride",
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: "#f47c4f",
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return "denied";

  const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPushToken(apiToken, pushToken, Platform.OS === "ios" ? "ios" : "android");
  await SecureStore.setItemAsync(TOKEN_KEY, pushToken);
  return "ok";
}

// Signing out: this phone stops getting this account's notifications
export async function unregisterPush(apiToken: string): Promise<void> {
  const pushToken = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!pushToken) return;
  await removePushToken(apiToken, pushToken).catch(() => {});
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// Tapping a notification opens what it's about. Returns a function that stops listening.
export function onNotificationTap(open: (url: string) => void): () => void {
  const openFrom = (response: Notifications.NotificationResponse | null) => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/")) open(url);
  };
  // Opened the app from a notification while it was closed
  Notifications.getLastNotificationResponseAsync().then(openFrom).catch(() => {});
  const subscription = Notifications.addNotificationResponseReceivedListener(openFrom);
  return () => subscription.remove();
}
