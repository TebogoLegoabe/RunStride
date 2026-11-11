// "Don't miss a message": asks people to turn notifications on, a few seconds after they open the
// app, until they do. "Not now" waits three days before asking again. If the phone or browser has
// blocked RunStride, it explains how to unblock it instead.
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as SecureStore from "expo-secure-store";
import { Text } from "./ui/Text";
import { getNotificationSettings } from "../lib/api";
import { askForPush, pushPermission, type PushPermission } from "../lib/push";
import { useChat } from "./ChatProvider";
import { colors, fonts, gradient, radius, shadow } from "../lib/theme";

const KEY = "runstride.pushPromptAt";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const DELAY_MS = 4000;

async function lastAsked(): Promise<number> {
  try {
    const raw = Platform.OS === "web" ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return Number(raw) || 0;
  } catch {
    return 0;
  }
}

async function snooze() {
  try {
    if (Platform.OS === "web") localStorage.setItem(KEY, String(Date.now()));
    else await SecureStore.setItemAsync(KEY, String(Date.now()));
  } catch {
    // it'll just ask again next time
  }
}

export function NotificationPrompt() {
  const { token } = useChat();
  const [state, setState] = useState<PushPermission | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        // Someone who switched notifications off in RunStride's own settings isn't nagged
        const [settings, permission, asked] = await Promise.all([getNotificationSettings(token), pushPermission(), lastAsked()]);
        if (!live || !settings.enabled || Date.now() - asked < SNOOZE_MS) return;
        if (permission === "ask" || permission === "blocked" || permission === "ios-install") {
          setState(permission);
          setOpen(true);
        }
      } catch {
        // no prompt this time
      }
    }, DELAY_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [token]);

  if (!open || !state) return null;

  const later = () => {
    snooze();
    setOpen(false);
  };

  const turnOn = async () => {
    if (!token) return;
    if (state === "blocked") {
      if (Platform.OS !== "web") Linking.openSettings().catch(() => {});
      later();
      return;
    }
    setBusy(true);
    try {
      const next = await askForPush(token);
      if (next === "granted" || next === "unsupported") setOpen(false);
      else {
        setState(next);
        if (next === "ask") later(); // closed the question without answering
      }
    } catch {
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const body =
    state === "ios-install"
      ? "On iPhone, add RunStride to your Home Screen first: tap Share, then Add to Home Screen. Open it from there and turn notifications on."
      : state === "blocked"
        ? Platform.OS === "web"
          ? "Notifications are blocked for RunStride in this browser. Click the icon to the left of the address, allow notifications, then reload."
          : "Notifications are switched off for RunStride on this phone. Turn them on in Settings so you don't miss a match or a message."
        : "Get told when someone likes you, matches with you, messages you or reacts to your message, even when RunStride is closed.";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.icon}>
            <Ionicons name="notifications" size={30} color={colors.onAccent} />
          </LinearGradient>
          <Text style={styles.title}>Don't miss a message</Text>
          <Text style={styles.body}>{body}</Text>
          {state !== "ios-install" && !(state === "blocked" && Platform.OS === "web") && (
            <Pressable style={styles.primary} onPress={turnOn} disabled={busy} accessibilityRole="button">
              {busy ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.primaryText}>{state === "blocked" ? "Open settings" : "Turn on notifications"}</Text>
              )}
            </Pressable>
          )}
          <Pressable style={styles.secondary} onPress={later} accessibilityRole="button">
            <Text style={styles.secondaryText}>{state === "ask" ? "Not now" : "OK"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
    alignSelf: "center",
    ...shadow.card,
  },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  title: { color: colors.heading, fontSize: 21, fontFamily: fonts.bold, textAlign: "center", marginBottom: 8 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: "center", marginBottom: 20 },
  primary: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignSelf: "stretch", alignItems: "center" },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
  secondary: { paddingVertical: 12, alignSelf: "stretch", alignItems: "center", marginTop: 4 },
  secondaryText: { color: colors.textMuted, fontSize: 15 },
});
