import { View, Pressable, StyleSheet, Modal, ActivityIndicator, Platform } from "react-native";
import { Text, TextInput } from "./ui/Text";
import { useEffect, useState } from "react";
import { ApiError, apiRequest } from "../lib/api";
import { colors, radius } from "../lib/theme";

type Props = { visible: boolean; token: string | null; onClose: () => void };

// "Send feedback": goes straight to the team's admin console
export function FeedbackSheet({ visible, token, onClose }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDone(false);
      setError(null);
    }
  }, [visible]);

  const send = async () => {
    if (!token || text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest<void>("/feedback", {
        method: "POST",
        body: { body: text.trim(), platform: Platform.OS },
        token,
      });
      setText("");
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach RunStride. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {done ? (
            <>
              <Text style={styles.title}>Thank you 🙏</Text>
              <Text style={styles.body}>A real person reads every message. It really helps.</Text>
              <Pressable style={styles.primary} onPress={onClose}>
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Send feedback</Text>
              <Text style={styles.body}>
                Something broken, confusing, or missing? Tell us. For a safety problem with a person, use Report on
                their profile instead.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="What happened, or what would make RunStride better?"
                placeholderTextColor={colors.textFaint}
                value={text}
                onChangeText={setText}
                multiline
                maxLength={2000}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                style={[styles.primary, (busy || text.trim().length < 3) && styles.disabled]}
                onPress={send}
                disabled={busy || text.trim().length < 3}
              >
                {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Send</Text>}
              </Pressable>
              <Pressable style={styles.cancel} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, width: "100%", maxWidth: 480, alignSelf: "center" },
  title: { color: colors.heading, fontSize: 20, fontWeight: "700", marginBottom: 6 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  input: {
    backgroundColor: colors.bg,
    color: colors.heading,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 120,
    textAlignVertical: "top",
    marginBottom: 12,
  },
  error: { color: colors.dangerText, fontSize: 13, marginBottom: 10 },
  primary: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 13, alignItems: "center" },
  disabled: { opacity: 0.45 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  cancel: { alignSelf: "center", padding: 12 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
