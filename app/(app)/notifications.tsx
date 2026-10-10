import { View, StyleSheet, Pressable, ScrollView, Switch, ActivityIndicator, Linking } from "react-native";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { useChat } from "../../components/ChatProvider";
import { ApiError, getNotificationSettings, setNotificationSettings } from "../../lib/api";
import { pushSupport, registerForPush } from "../../lib/push";
import { useTopPadding } from "../../lib/responsive";
import type { NotificationSettings } from "../../lib/types";
import { colors, fonts, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

const KINDS: { key: keyof Omit<NotificationSettings, "enabled">; icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { key: "messages", icon: "chatbubble-outline", title: "Messages", body: "New chat messages and run plans" },
  { key: "matches", icon: "heart-outline", title: "Matches and chat requests", body: "New matches, and runners asking to chat" },
  { key: "races", icon: "at", title: "Race chat mentions", body: "When someone @mentions you" },
  { key: "swaps", icon: "swap-horizontal", title: "Entry swap alerts", body: "When an entry you want is offered" },
];

// Why this device can't get push notifications, in plain words
const UNSUPPORTED: Record<string, string> = {
  web: "Push notifications come to the RunStride phone app. In the browser, new things show while RunStride is open.",
  "expo-go": "Push notifications need the RunStride app itself (a development or store build). Expo Go can't receive them.",
  simulator: "Push notifications only work on a real phone, not a simulator.",
  "not-configured": "Push notifications aren't set up in this build yet.",
  denied: "Notifications are turned off for RunStride in your phone's settings.",
};

export default function NotificationsScreen() {
  const router = useRouter();
  const topPadding = useTopPadding();
  const { token } = useChat();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [deviceIssue, setDeviceIssue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getNotificationSettings(token)
      .then(setSettings)
      .catch((e) => setError(e instanceof ApiError ? e.message : NETWORK_ERROR));
    const support = pushSupport();
    if (support !== "ok") setDeviceIssue(support);
  }, [token]);

  const save = async (next: NotificationSettings) => {
    if (!token || !settings) return;
    const before = settings;
    setSettings(next); // straight away; put back if saving fails
    setError(null);
    try {
      setSettings(await setNotificationSettings(token, next));
      // Turning push on: make sure this phone is signed up (asks permission the first time)
      if (next.enabled && !before.enabled) {
        const result = await registerForPush(token);
        setDeviceIssue(result === "ok" ? null : result);
      }
    } catch (e) {
      setSettings(before);
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: topPadding }]}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))}
        style={styles.back}
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={colors.textBright} />
        <Text style={styles.backText}>Profile</Text>
      </Pressable>
      <Text style={styles.title}>Notifications</Text>

      {settings === null ? (
        error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          <View style={styles.group}>
            <View style={styles.row}>
              <Ionicons name="notifications" size={22} color={colors.primary} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Push notifications</Text>
                <Text style={styles.rowBody}>
                  {settings.enabled
                    ? "Get notified on your phone when RunStride is closed."
                    : "Off: you'll see new messages and alerts only while RunStride is open."}
                </Text>
              </View>
              <Switch
                value={settings.enabled}
                onValueChange={(enabled) => save({ ...settings, enabled })}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.heading}
                accessibilityLabel="Push notifications"
              />
            </View>
          </View>

          {deviceIssue && settings.enabled && (
            <View style={styles.notice}>
              <Ionicons name="information-circle" size={18} color={colors.warningText} />
              <Text style={styles.noticeText}>{UNSUPPORTED[deviceIssue]}</Text>
              {deviceIssue === "denied" && (
                <Pressable onPress={() => Linking.openSettings()}>
                  <Text style={styles.noticeLink}>Open settings</Text>
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.section}>Notify me about</Text>
          <View style={[styles.group, !settings.enabled && styles.disabled]}>
            {KINDS.map((kind) => (
              <View key={kind.key} style={styles.row}>
                <Ionicons name={kind.icon} size={20} color={colors.textMuted} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{kind.title}</Text>
                  <Text style={styles.rowBody}>{kind.body}</Text>
                </View>
                <Switch
                  value={settings[kind.key]}
                  disabled={!settings.enabled}
                  onValueChange={(on) => save({ ...settings, [kind.key]: on })}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.heading}
                  accessibilityLabel={kind.title}
                />
              </View>
            ))}
          </View>
          <Text style={styles.footnote}>
            Message text never shows on your lock screen, only who it's from. Run-day safety alerts to your trusted
            contacts are sent by SMS and aren't affected by these settings.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48, maxWidth: 560, width: "100%", alignSelf: "center" },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 8, marginLeft: -6 },
  backText: { color: colors.textBright, fontSize: 16 },
  title: { color: colors.heading, fontSize: 26, fontFamily: fonts.extrabold, marginBottom: 16 },
  section: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.bold, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden" },
  disabled: { opacity: 0.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.textBright, fontSize: 16 },
  rowBody: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  notice: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: colors.warningTint,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 12,
  },
  noticeText: { color: colors.warningSoft, fontSize: 13, lineHeight: 18, flex: 1 },
  noticeLink: { color: colors.warningText, fontSize: 13, fontFamily: fonts.bold },
  footnote: { color: colors.textFaint, fontSize: 12, lineHeight: 17, marginTop: 14, marginHorizontal: 4 },
  error: { color: colors.dangerText, fontSize: 14, marginTop: 12, textAlign: "center" },
});
