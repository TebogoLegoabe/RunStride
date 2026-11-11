import { memo, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { Text } from "../ui/Text";
import { VoiceNote } from "./VoiceNote";
import { mediaUrl } from "../../lib/api";
import { formatClock } from "../../lib/format";
import { haptics } from "../../lib/haptics";
import type { Message, Reaction, ReplyPreview } from "../../lib/types";
import { colors, fonts } from "../../lib/theme";

export const PHOTO_BODY = "📷 Photo";
const SWIPE_TO_REPLY = 56; // how far to drag before letting go starts a reply
const MAX_PHOTO_WIDTH = 240;

type Props = {
  m: Message;
  mine: boolean;
  myId: string | null;
  otherName: string;
  // Position in a run of messages from the same person: only the last gets the tail and a gap after
  first: boolean;
  last: boolean;
  highlighted: boolean;
  onReply: (m: Message) => void;
  onMenu: (m: Message) => void;
  onOpenPhoto: (url: string) => void;
  onJumpTo: (id: string) => void;
};

// "You" or their name, and what a quoted message says in a line
export function quoteLabel(q: Pick<ReplyPreview, "senderId" | "kind" | "body">, myId: string | null, otherName: string) {
  const who = q.senderId === myId ? "You" : otherName;
  const what = q.kind === "voice" ? "🎤 Voice message" : q.kind === "image" && q.body !== PHOTO_BODY ? `📷 ${q.body}` : q.body;
  return { who, what };
}

function Quote({ q, myId, otherName, mine, onPress }: { q: ReplyPreview; myId: string | null; otherName: string; mine: boolean; onPress: () => void }) {
  const { who, what } = quoteLabel(q, myId, otherName);
  const accent = q.senderId === myId ? (mine ? colors.onPrimary : colors.primary) : colors.pink;
  return (
    <Pressable onPress={onPress} style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]} accessibilityLabel={`Reply to ${who}: ${what}`}>
      <View style={[styles.quoteBar, { backgroundColor: accent }]} />
      <View style={styles.quoteText}>
        <Text style={[styles.quoteWho, { color: accent }]} numberOfLines={1}>
          {who}
        </Text>
        <Text style={[styles.quoteWhat, mine && styles.textMineMuted]} numberOfLines={2}>
          {what}
        </Text>
      </View>
      {q.kind === "image" && q.mediaUrl && <Image source={{ uri: mediaUrl(q.mediaUrl) }} style={styles.quoteThumb} />}
    </Pressable>
  );
}

// Each emoji once, with how many people chose it
function Reactions({ reactions, myId, mine, onPress }: { reactions: Reaction[]; myId: string | null; mine: boolean; onPress: () => void }) {
  const counts = new Map<string, number>();
  reactions.forEach((r) => counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1));
  const iReacted = reactions.some((r) => r.userId === myId);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.reactions, mine ? styles.reactionsMine : styles.reactionsTheirs, iReacted && styles.reactionsByMe]}
      accessibilityLabel={`Reactions: ${[...counts.keys()].join(" ")}`}
    >
      {[...counts.entries()].map(([emoji, n]) => (
        <Text key={emoji} style={styles.reactionEmoji} allowFontScaling={false}>
          {emoji}
          {n > 1 ? <Text style={styles.reactionCount}> {n}</Text> : null}
        </Text>
      ))}
    </Pressable>
  );
}

function MessageBubbleBase({ m, mine, myId, otherName, first, last, highlighted, onReply, onMenu, onOpenPhoto, onJumpTo }: Props) {
  const x = useSharedValue(0);
  const [hovered, setHovered] = useState(false);
  const web = Platform.OS === "web";

  const startReply = () => {
    haptics.tap();
    onReply(m);
  };
  // Drag right (a little resistance), let go past the mark to reply; vertical drags scroll the chat
  const swipe = Gesture.Pan()
    .activeOffsetX([-10000, 14])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      x.value = Math.max(0, Math.min(90, e.translationX * 0.6));
    })
    .onEnd(() => {
      if (x.value >= SWIPE_TO_REPLY) runOnJS(startReply)();
      x.value = withSpring(0, { damping: 18, stiffness: 220 });
    });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const hint = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [10, SWIPE_TO_REPLY], [0, 1], "clamp"),
    transform: [{ scale: interpolate(x.value, [10, SWIPE_TO_REPLY], [0.6, 1], "clamp") }],
  }));

  const isPhoto = m.kind === "image" && !!m.mediaUrl;
  const caption = isPhoto && m.body !== PHOTO_BODY ? m.body : null;
  const ratio = m.mediaWidth && m.mediaHeight ? m.mediaHeight / m.mediaWidth : 1;
  const photoHeight = Math.max(120, Math.min(320, MAX_PHOTO_WIDTH * ratio));
  const reactions = m.reactions ?? [];

  const meta = (
    <View style={[styles.meta, isPhoto && !caption && styles.metaOnPhoto]}>
      <Text style={[styles.time, mine && styles.timeMine, isPhoto && !caption && styles.timeOnPhoto]}>{formatClock(m.createdAt)}</Text>
      {mine && (
        <Ionicons
          name={m.readAt ? "checkmark-done" : "checkmark"}
          size={15}
          color={isPhoto && !caption ? colors.onPhoto : m.readAt ? colors.onPrimary : colors.onPrimaryMuted}
          accessibilityLabel={m.readAt ? "Read" : "Sent"}
        />
      )}
    </View>
  );

  return (
    <View style={[styles.row, last && styles.rowLast, reactions.length > 0 && styles.rowReacted, highlighted && styles.highlighted]}>
      <Animated.View style={[styles.replyHint, hint]} pointerEvents="none">
        <Ionicons name="arrow-undo" size={18} color={colors.primary} />
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.slide, mine && styles.slideMine, slide]}>
          {web && mine && hovered && <HoverTools onReply={startReply} onMenu={() => onMenu(m)} />}
          <Pressable
            onLongPress={() => {
              haptics.tap();
              onMenu(m);
            }}
            delayLongPress={280}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={[
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubbleTheirs,
              isPhoto && styles.bubblePhoto,
              mine ? !first && styles.joinedTopMine : !first && styles.joinedTopTheirs,
              mine ? !last && styles.joinedBottomMine : !last && styles.joinedBottomTheirs,
              last && (mine ? styles.tailMine : styles.tailTheirs),
            ]}
          >
            {m.replyTo && (
              <Quote q={m.replyTo} myId={myId} otherName={otherName} mine={mine} onPress={() => onJumpTo(m.replyTo!.id)} />
            )}
            {isPhoto ? (
              <Pressable onPress={() => onOpenPhoto(m.mediaUrl!)} accessibilityLabel="Open photo" onLongPress={() => onMenu(m)}>
                <Image source={{ uri: mediaUrl(m.mediaUrl!) }} style={[styles.photo, { height: photoHeight }]} resizeMode="cover" />
                {!caption && meta}
              </Pressable>
            ) : m.kind === "voice" && m.mediaUrl ? (
              <VoiceNote id={m.id} url={m.mediaUrl} durationMs={m.mediaDurationMs} mine={mine} />
            ) : null}
            {(m.kind === "text" || caption) && (
              <Text style={[styles.text, mine && styles.textMine, isPhoto && styles.caption]}>{caption ?? m.body}</Text>
            )}
            {(!isPhoto || caption) && meta}
            {reactions.length > 0 && <Reactions reactions={reactions} myId={myId} mine={mine} onPress={() => onMenu(m)} />}
          </Pressable>
          {web && !mine && hovered && <HoverTools onReply={startReply} onMenu={() => onMenu(m)} />}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// Computers: react and reply buttons appear beside a message under the mouse
function HoverTools({ onReply, onMenu }: { onReply: () => void; onMenu: () => void }) {
  return (
    <View style={styles.hoverTools}>
      <Pressable onPress={onMenu} style={styles.hoverButton} accessibilityLabel="React">
        <Ionicons name="happy-outline" size={17} color={colors.textMuted} />
      </Pressable>
      <Pressable onPress={onReply} style={styles.hoverButton} accessibilityLabel="Reply">
        <Ionicons name="arrow-undo-outline" size={17} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleBase);

const R = 18; // bubble corner radius
const styles = StyleSheet.create({
  row: { marginTop: 2, paddingHorizontal: 4, borderRadius: 12 },
  rowLast: { marginBottom: 6 },
  rowReacted: { marginBottom: 18 },
  highlighted: { backgroundColor: colors.primaryTint },
  replyHint: {
    position: "absolute",
    left: 4,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  slide: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 6 },
  slideMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: R, paddingHorizontal: 12, paddingTop: 7, paddingBottom: 5 },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: colors.surface },
  bubblePhoto: { padding: 4, paddingBottom: 4 },
  // A run of messages reads as one block: the inside corners tighten
  joinedTopMine: { borderTopRightRadius: 6 },
  joinedBottomMine: { borderBottomRightRadius: 6 },
  joinedTopTheirs: { borderTopLeftRadius: 6 },
  joinedBottomTheirs: { borderBottomLeftRadius: 6 },
  tailMine: { borderBottomRightRadius: 3 },
  tailTheirs: { borderBottomLeftRadius: 3 },
  text: { color: colors.textBright, fontSize: 15.5, lineHeight: 21 },
  textMine: { color: colors.onPrimary },
  textMineMuted: { color: colors.onPrimaryMuted },
  caption: { paddingHorizontal: 6, paddingTop: 6 },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 1, paddingHorizontal: 2 },
  metaOnPhoto: {
    position: "absolute",
    right: 8,
    bottom: 8,
    backgroundColor: colors.scrimStrong,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  time: { color: colors.textFaint, fontSize: 11 },
  timeMine: { color: colors.onPrimaryMuted },
  timeOnPhoto: { color: colors.onPhoto },
  photo: { width: MAX_PHOTO_WIDTH, borderRadius: R - 4, backgroundColor: colors.border },
  quote: { flexDirection: "row", borderRadius: 10, overflow: "hidden", marginBottom: 6, minWidth: 160 },
  quoteMine: { backgroundColor: "rgba(0,0,0,0.12)" },
  quoteTheirs: { backgroundColor: colors.primaryTintSoft },
  quoteBar: { width: 4 },
  quoteText: { flex: 1, paddingHorizontal: 8, paddingVertical: 6 },
  quoteWho: { fontSize: 12.5, fontFamily: fonts.bold },
  quoteWhat: { color: colors.textMuted, fontSize: 13, lineHeight: 17 },
  quoteThumb: { width: 44, height: 44 },
  reactions: {
    position: "absolute",
    bottom: -16,
    flexDirection: "row",
    gap: 2,
    backgroundColor: colors.surface,
    borderColor: colors.bg,
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  reactionsMine: { right: 10 },
  reactionsTheirs: { left: 10 },
  reactionsByMe: { backgroundColor: colors.primaryTint },
  reactionEmoji: { fontSize: 14, lineHeight: 20 },
  reactionCount: { fontSize: 11, color: colors.textMuted, fontFamily: fonts.bold },
  hoverTools: { flexDirection: "row", gap: 2 },
  hoverButton: { padding: 5, borderRadius: 14, backgroundColor: colors.surface },
});
