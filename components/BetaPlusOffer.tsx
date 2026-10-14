import { View, Pressable, StyleSheet, Modal, ActivityIndicator } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { Text } from "./ui/Text";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, activateBetaPlus } from "../lib/api";
import { haptics } from "../lib/haptics";
import { useMembership } from "./MembershipProvider";
import { colors, fonts, radius } from "../lib/theme";

const PERKS = [
  "Unlimited likes",
  "See everyone going to your races",
  "Instant swap and entry alerts",
  "Message anyone at a race",
];

// The free RunStride Plus for beta members: one tap to switch on. Shown until they take it (or close it for
// now), and gone for good once activated. When payments arrive this becomes the "your trial is ending" prompt.
export function BetaPlusOffer({ token }: { token: string | null }) {
  const { membership, update } = useMembership();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = membership?.betaOfferDays ?? 0;
  const visible = !dismissed && (days > 0 || done);
  if (!visible) return null;

  const activate = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      update(await activateBetaPlus(token));
      haptics.success();
      setDone(true);
      setTimeout(() => setDismissed(true), 2200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach RunStride. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => setDismissed(true)}>
      <Animated.View entering={FadeIn.duration(200)} style={styles.backdrop}>
        <Animated.View entering={ZoomIn.duration(220)} style={styles.card}>
          <View style={styles.icon}>
            <Ionicons name={done ? "checkmark" : "flash"} size={30} color={colors.onPrimary} />
          </View>
          {done ? (
            <>
              <Text style={styles.title}>You're a Plus member 🎉</Text>
              <Text style={styles.body}>Enjoy RunStride Plus. It's all switched on.</Text>
            </>
          ) : (
            <>
              <Text style={styles.kicker}>Beta members only</Text>
              <Text style={styles.title}>Activate RunStride Plus</Text>
              <Text style={styles.body}>
                Free for {days} days while we're in beta. No card, nothing to pay.
              </Text>
              <View style={styles.perks}>
                {PERKS.map((p) => (
                  <View key={p} style={styles.perk}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                    <Text style={styles.perkText}>{p}</Text>
                  </View>
                ))}
              </View>
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={[styles.button, busy && styles.busy]} onPress={activate} disabled={busy} accessibilityRole="button">
                {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Activate free Plus</Text>}
              </Pressable>
              <Pressable onPress={() => setDismissed(true)} style={styles.later}>
                <Text style={styles.laterText}>Maybe later</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.xl, padding: 24, alignItems: "center" },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  kicker: { color: colors.primary, fontSize: 12, fontFamily: fonts.bold, textTransform: "uppercase", marginBottom: 4 },
  title: { color: colors.heading, fontSize: 24, fontFamily: fonts.bold, textAlign: "center" },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: 8 },
  perks: { alignSelf: "stretch", gap: 8, marginTop: 16, marginBottom: 18 },
  perk: { flexDirection: "row", alignItems: "center", gap: 10 },
  perkText: { color: colors.text, fontSize: 14, flex: 1 },
  error: { color: colors.dangerText, fontSize: 13, marginBottom: 10, textAlign: "center" },
  button: { alignSelf: "stretch", backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: "center" },
  busy: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontFamily: fonts.bold },
  later: { padding: 12 },
  laterText: { color: colors.textMuted, fontSize: 14 },
});
