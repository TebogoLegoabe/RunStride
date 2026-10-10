// Signs this phone up for push notifications (if the user wants them) and opens the right
// screen when a notification is tapped. Renders nothing.
import { useEffect } from "react";
import { useRouter, type Href } from "expo-router";
import { getNotificationSettings } from "../lib/api";
import { onNotificationTap, registerForPush } from "../lib/push";
import { useChat } from "./ChatProvider";

export function PushManager() {
  const router = useRouter();
  const { token } = useChat();

  useEffect(() => {
    if (!token) return;
    getNotificationSettings(token)
      .then((settings) => (settings.enabled ? registerForPush(token) : null))
      .catch(() => {}); // no push this time; the app still shows everything while open
  }, [token]);

  useEffect(() => onNotificationTap((url) => router.push(url as Href)), [router]);

  return null;
}
