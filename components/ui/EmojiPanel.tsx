import { useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { Text } from "./Text";
import { Ionicons } from "@expo/vector-icons";
import { haptics } from "../../lib/haptics";
import { colors, radius } from "../../lib/theme";

// Runner-themed first, then the usual suspects. Phones also have their own emoji keyboard; this is for
// the web (where there isn't one) and for quick picks while chatting.
const GROUPS: { icon: string; label: string; emojis: string[] }[] = [
  {
    icon: "🏃",
    label: "Running",
    emojis: [
      "🏃", "🏃‍♀️", "🏃‍♂️", "👟", "🏅", "🏆", "🥇", "🥈", "🥉", "🏁", "⏱️", "🔥", "💪", "⚡", "🌅", "☀️", "🌧️", "⛰️",
      "🌲", "💧", "🍌", "🥤", "🎽", "🎉", "🙌", "👏", "🇿🇦", "🦁",
    ],
  },
  {
    icon: "😀",
    label: "Faces",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😋", "😜",
      "🤗", "🤔", "😬", "🙄", "😴", "😢", "😭", "😮", "😏", "😇", "🤭", "😳", "🥵",
    ],
  },
  {
    icon: "❤️",
    label: "Hearts",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💕", "💞", "💘", "💝", "💗", "✨", "🌟", "💯", "😻"],
  },
  {
    icon: "👍",
    label: "Hands",
    emojis: ["👍", "👎", "👏", "🙌", "🙏", "🤝", "💪", "✌️", "🤞", "👌", "🤙", "👋", "🫶", "🫡", "🤟", "👊"],
  },
  {
    icon: "🍻",
    label: "Fun",
    emojis: ["🍻", "🍺", "☕", "🍕", "🍔", "🥗", "🎶", "🎵", "🌍", "🌈", "🐆", "🐶", "🎯", "🎁", "📸", "🗓️", "📍", "🚗"],
  },
];

type Props = { onPick: (emoji: string) => void; onClose: () => void };

export function EmojiPanel({ onPick, onClose }: Props) {
  const [group, setGroup] = useState(0);
  return (
    <View style={styles.panel}>
      <View style={styles.tabs}>
        {GROUPS.map((g, i) => (
          <Pressable
            key={g.label}
            onPress={() => setGroup(i)}
            accessibilityLabel={g.label}
            style={[styles.tab, i === group && styles.tabOn]}
          >
            <Text style={styles.tabIcon}>{g.icon}</Text>
          </Pressable>
        ))}
        <View style={styles.grow} />
        <Pressable onPress={onClose} accessibilityLabel="Close emojis" hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {GROUPS[group].emojis.map((e) => (
          <Pressable
            key={e}
            onPress={() => {
              haptics.tap();
              onPick(e);
            }}
            accessibilityLabel={e}
            style={styles.cell}
          >
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

// The little smiley that opens the panel
export function EmojiToggle({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={open ? "Hide emojis" : "Show emojis"} style={styles.toggle}>
      <Ionicons name={open ? "happy" : "happy-outline"} size={24} color={open ? colors.primary : colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingTop: 6, marginTop: 10 },
  tabs: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 2 },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.primaryTint },
  tabIcon: { fontSize: 20 },
  grow: { flex: 1 },
  close: { padding: 6 },
  scroll: { maxHeight: 176 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 8, paddingTop: 4 },
  cell: { width: "12.5%", minWidth: 40, alignItems: "center", justifyContent: "center", paddingVertical: 7 },
  emoji: { fontSize: 26 },
  toggle: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
