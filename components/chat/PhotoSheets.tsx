import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text, TextInput } from "../ui/Text";
import { mediaUrl } from "../../lib/api";
import { colors, radius } from "../../lib/theme";

// Before sending a photo: see it, add a caption, send or cancel
export function PhotoComposer({
  uri,
  sending,
  error,
  onSend,
  onCancel,
}: {
  uri: string | null;
  sending: boolean;
  error: string | null;
  onSend: (caption: string) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState("");
  const { width, height } = useWindowDimensions();
  useEffect(() => setCaption(""), [uri]);
  if (!uri) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.dark}>
        <Pressable onPress={onCancel} style={styles.close} accessibilityLabel="Cancel" hitSlop={10}>
          <Ionicons name="close" size={28} color={colors.onPhoto} />
        </Pressable>
        <Image source={{ uri }} style={{ width: Math.min(width, 720), height: height * 0.62 }} resizeMode="contain" />
        <View style={styles.captionRow}>
          <TextInput
            style={styles.caption}
            placeholder="Add a caption…"
            placeholderTextColor={colors.onPhotoMuted}
            value={caption}
            onChangeText={setCaption}
            maxLength={1000}
            multiline
          />
          <Pressable style={styles.send} onPress={() => onSend(caption)} disabled={sending} accessibilityLabel="Send photo">
            {sending ? <ActivityIndicator color={colors.onAccent} /> : <Ionicons name="send" size={20} color={colors.onAccent} />}
          </Pressable>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </Modal>
  );
}

// Tapping a photo in the chat: full screen, tap anywhere to close
export function PhotoViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.dark} onPress={onClose} accessibilityLabel="Close photo">
        <Image source={{ uri: mediaUrl(url) }} style={styles.full} resizeMode="contain" />
        <View style={styles.close}>
          <Ionicons name="close" size={28} color={colors.onPhoto} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dark: { flex: 1, backgroundColor: "rgba(10, 0, 16, 0.96)", alignItems: "center", justifyContent: "center", padding: 16 },
  close: { position: "absolute", top: 44, right: 20, zIndex: 2, padding: 4 },
  full: { width: "100%", height: "100%" },
  captionRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, width: "100%", maxWidth: 720, marginTop: 16 },
  caption: {
    flex: 1,
    maxHeight: 110,
    color: colors.onPhoto,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primaryOnPhoto, alignItems: "center", justifyContent: "center" },
  error: { color: "#fca5a5", marginTop: 10, textAlign: "center" },
});
