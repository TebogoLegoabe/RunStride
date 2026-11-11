import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Text } from "../ui/Text";
import { EmojiPanel } from "../ui/EmojiPanel";
import { PHOTO_BODY, quoteLabel } from "./MessageBubble";
import type { Message } from "../../lib/types";
import { colors, fonts, radius, shadow } from "../../lib/theme";
import { useSkinTone, withTone } from "../../lib/skinTone";

export const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🏃"];

type Props = {
  message: Message | null;
  myId: string | null;
  otherName: string;
  onClose: () => void;
  onReact: (m: Message, emoji: string | null) => void;
  onReply: (m: Message) => void;
};

// Long-press (or the smiley on computers): react with an emoji, reply, or copy the text
export function MessageMenu({ message, myId, otherName, onClose, onReact, onReply }: Props) {
  const [more, setMore] = useState(false);
  const tone = useSkinTone();
  if (!message) return null;
  const mine = message.reactions?.find((r) => r.userId === myId)?.emoji ?? null;
  const text = message.kind === "text" || (message.kind === "image" && message.body !== PHOTO_BODY) ? message.body : null;
  const { who, what } = quoteLabel(message, myId, otherName);

  const close = () => {
    setMore(false);
    onClose();
  };
  const react = (emoji: string) => {
    onReact(message, emoji === mine ? null : emoji); // tapping your own reaction again removes it
    close();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close">
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.preview} numberOfLines={2}>
            <Text style={styles.previewWho}>{who}: </Text>
            {what}
          </Text>
          {more ? (
            <EmojiPanel onPick={react} onClose={() => setMore(false)} />
          ) : (
            <View style={styles.emojis}>
              {QUICK_REACTIONS.map((plain) => withTone(plain, tone)).map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => react(emoji)}
                  style={[styles.emoji, emoji === mine && styles.emojiMine]}
                  accessibilityLabel={emoji === mine ? `Remove ${emoji}` : `React ${emoji}`}
                >
                  <Text style={styles.emojiText} allowFontScaling={false}>
                    {emoji}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setMore(true)} style={styles.emoji} accessibilityLabel="More emoji">
                <Ionicons name="add" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
          )}
          <View style={styles.actions}>
            <Action
              icon="arrow-undo-outline"
              label="Reply"
              onPress={() => {
                onReply(message);
                close();
              }}
            />
            {text && (
              <Action
                icon="copy-outline"
                label="Copy"
                onPress={() => {
                  Clipboard.setStringAsync(text).catch(() => {});
                  close();
                }}
              />
            )}
            {mine && <Action icon="close-circle-outline" label={`Remove ${mine}`} onPress={() => react(mine)} />}
          </View>
          {Platform.OS !== "web" && <Text style={styles.tip}>Tip: swipe a message right to reply.</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={colors.textBright} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "center", padding: 20 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    ...shadow.card,
  },
  preview: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  previewWho: { color: colors.heading, fontFamily: fonts.bold },
  emojis: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 4 },
  emoji: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  emojiMine: { backgroundColor: colors.primaryTint, borderWidth: 2, borderColor: colors.primary },
  emojiText: { fontSize: 24, lineHeight: 30 },
  actions: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 4 },
  actionText: { color: colors.textBright, fontSize: 15 },
  tip: { color: colors.textFaint, fontSize: 12, marginTop: 4, textAlign: "center" },
});
