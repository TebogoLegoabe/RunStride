import { View, Pressable, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { Text } from "./ui/Text";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { enableWebPush, webPushState, type WebPushState } from "../lib/push.web";
import { dismissTip, tipDismissed } from "../lib/tips";
import { colors, radius } from "../lib/theme";

type Props = {
  token: string | null;
  // In Notifications settings it always shows its state; elsewhere it's a card people can close
  persistent?: boolean;
};

const TIP = "web-push";

// Web only: "Turn on notifications", so people hear about likes and messages with RunStride closed
export function WebPushCard({ token, persistent = false }: Props) {
  const [state, setState] = useState<WebPushState | null>(null);
  const [hidden, setHidden] = useState(!persistent);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    webPushState().then(setState).catch(() => setState("unsupported"));
    if (!persistent) tipDismissed(TIP).then((done) => setHidden(done));
  }, [persistent]);

  if (Platform.OS !== "web" || state === null || hidden) return null;
  if (state === "unsupported" || state === "not-configured") {
    return persistent ? (
      <Note icon="information-circle" text="This browser can't show notifications. New things still show while RunStride is open." />
    ) : null;
  }
  if (state === "on") {
    return persistent ? <Note icon="checkmark-circle" text="Notifications are on in this browser." ok /> : null;
  }
  if (state === "denied") {
    return persistent ? (
      <Note
        icon="notifications-off"
        text="Notifications are blocked for RunStride in this browser. Allow them in the browser's site settings (the icon left of the address)."
      />
    ) : null;
  }

  const turnOn = async () => {
    if (!token) return;
    setBusy(true);
    try {
      setState(await enableWebPush(token));
    } catch {
      setState("unsupported");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Ionicons name="notifications" size={22} color={colors.primary} />
      <View style={styles.body}>
        <Text style={styles.title}>Don't miss a match</Text>
        <Text style={styles.text}>
          {state === "ios-install"
            ? "On iPhone: tap the Share button, then Add to Home Screen. Open RunStride from your Home Screen and turn notifications on there."
            : "Get a notification when someone likes you, messages you or mentions you in a race chat."}
        </Text>
        {state === "off" && (
          <Pressable style={styles.button} onPress={turnOn} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Turn on notifications</Text>}
          </Pressable>
        )}
      </View>
      {!persistent && (
        <Pressable
          onPress={() => {
            setHidden(true);
            dismissTip(TIP);
          }}
          accessibilityLabel="Not now"
          hitSlop={10}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}

function Note({ icon, text, ok }: { icon: keyof typeof Ionicons.glyphMap; text: string; ok?: boolean }) {
  return (
    <View style={styles.note}>
      <Ionicons name={icon} size={18} color={ok ? colors.primary : colors.textMuted} />
      <Text style={styles.noteText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.primaryTintSoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
  },
  body: { flex: 1 },
  title: { color: colors.heading, fontSize: 15, fontWeight: "700", marginBottom: 2 },
  text: { color: colors.text, fontSize: 13, lineHeight: 19 },
  button: {
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
  note: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 12 },
  noteText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
});
