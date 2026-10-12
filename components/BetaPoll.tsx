import { View, Pressable, StyleSheet, Modal } from "react-native";
import { Text } from "./ui/Text";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest } from "../lib/api";
import { dismissTip, tipDismissed } from "../lib/tips";
import { colors } from "../lib/theme";

type Poll = { id: string; question: string; options: { value: string; label: string }[]; answered: boolean };

// One question for beta testers, shown until they answer or tap "Not now". Never blocks anything.
export function BetaPoll({ token }: { token: string | null }) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [open, setOpen] = useState(false);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      try {
        const p = await apiRequest<Poll>("/me/poll", { token });
        if (!live || p.answered || (await tipDismissed(`poll.${p.id}`))) return;
        setPoll(p);
        setOpen(true);
      } catch {
        // a poll isn't worth an error message
      }
    })();
    return () => {
      live = false;
    };
  }, [token]);

  if (!poll) return null;

  const close = () => {
    setOpen(false);
    dismissTip(`poll.${poll.id}`);
  };
  const answer = async (value: string) => {
    setThanks(true);
    try {
      await apiRequest<void>("/me/poll", { method: "POST", body: { answer: value }, token: token ?? undefined });
    } catch {
      // keep the thank-you; losing one vote is fine
    }
    setTimeout(() => setOpen(false), 1200);
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {thanks ? (
            <Text style={styles.title}>Thanks, that helps us decide! 🙏</Text>
          ) : (
            <>
              <Text style={styles.kicker}>Quick beta question</Text>
              <Text style={styles.title}>{poll.question}</Text>
              {poll.options.map((o) => (
                <Pressable key={o.value} style={styles.option} onPress={() => answer(o.value)} accessibilityRole="button">
                  <Text style={styles.optionText}>{o.label}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))}
              <Pressable onPress={close} style={styles.later}>
                <Text style={styles.laterText}>Not now</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: "center", justifyContent: "center", padding: 16 },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, width: "100%", maxWidth: 440 },
  kicker: { color: colors.primary, fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 6 },
  title: { color: colors.heading, fontSize: 19, fontWeight: "700", marginBottom: 14 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginBottom: 10,
  },
  optionText: { flex: 1, color: colors.heading, fontSize: 15, fontWeight: "600" },
  later: { alignSelf: "center", padding: 8 },
  laterText: { color: colors.textMuted, fontSize: 14 },
});
