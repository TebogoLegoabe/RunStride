// A banner that drops in when an entry you're looking for (or a buyer for yours) appears on a
// race's swap board. Tapping it opens that race's swap board.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeOutUp, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { useChat } from "./ChatProvider";
import { haptics } from "../lib/haptics";
import { colors, fonts, radius, shadow } from "../lib/theme";
import type { RealtimeEvent } from "../lib/types";

const SHOW_MS = 7000;

type SwapMatch = Extract<RealtimeEvent, { type: "swap_match" }>;

export function SwapAlertBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { subscribe } = useChat();
  const [alert, setAlert] = useState<SwapMatch | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== "swap_match") return;
        haptics.success();
        setAlert(event);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setAlert(null), SHOW_MS);
      }),
    [subscribe]
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!alert) return null;
  const distance = alert.eventLabel ? `${alert.eventLabel} ` : "";
  const title = alert.kind === "offering" ? `A ${distance}entry is available` : `Someone wants your ${distance}entry`;

  return (
    <Animated.View
      entering={SlideInUp.springify().damping(16)}
      exiting={FadeOutUp.duration(200)}
      style={[styles.wrap, { top: insets.top + 8 }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={styles.banner}
        accessibilityRole="button"
        accessibilityLabel={`${title} at ${alert.raceName}. Open the swap board.`}
        onPress={() => {
          setAlert(null);
          router.push({ pathname: "/race/[raceId]", params: { raceId: alert.raceId, section: "swaps" } });
        }}
      >
        <View style={styles.icon}>
          <Ionicons name="swap-horizontal" size={20} color={colors.heading} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body} numberOfLines={1}>
            {alert.raceName} · Tap to see the swap board
          </Text>
        </View>
        <Pressable onPress={() => setAlert(null)} accessibilityLabel="Dismiss" hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, alignItems: "center", zIndex: 100 },
  banner: {
    width: "100%",
    maxWidth: 480,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: 12,
    ...shadow.card,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1 },
  title: { color: colors.heading, fontSize: 15, fontFamily: fonts.bold },
  body: { color: colors.textMuted, fontSize: 13 },
});
