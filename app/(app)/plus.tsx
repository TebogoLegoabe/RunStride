import { View, StyleSheet, Pressable, ScrollView } from "react-native";
import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { useChat } from "../../components/ChatProvider";
import { useMembership } from "../../components/MembershipProvider";
import { ApiError } from "../../lib/api";
import { formatRaceDates } from "../../lib/format";
import { haptics } from "../../lib/haptics";
import { PLUS_FEATURES, PLUS_PLANS, RACE_PASS, RACE_PASS_FEATURES } from "../../lib/plans";
import { buy, getRacePass, PurchasesUnavailable } from "../../lib/purchases";
import { hoverable, useTopPadding } from "../../lib/responsive";
import type { ProductId } from "../../lib/types";
import { colors, fonts, gradient, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

const formatDate = (iso: string) => formatRaceDates(iso.slice(0, 10), iso.slice(0, 10));

// RunStride Plus: what it includes, the plans, and a race pass when opened from a race.
// Opened from anywhere a free limit is reached, with the reason at the top.
export default function PlusScreen() {
  const router = useRouter();
  const topPadding = useTopPadding();
  const { token } = useChat();
  const { membership, update } = useMembership();
  const { reason, raceId, raceName } = useLocalSearchParams<{ reason?: string; raceId?: string; raceName?: string }>();
  const [choice, setChoice] = useState<ProductId>(raceId ? "race_pass" : "plus_monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/discover"));
  const plus = membership?.plus;
  const hasPassHere = !!raceId && !!membership?.racePasses.some((p) => p.raceId === raceId);

  const purchase = async () => {
    if (!token || !membership) return;
    setBusy(true);
    setError(null);
    try {
      const next =
        choice === "race_pass" && raceId
          ? await getRacePass(token, membership, raceId)
          : await buy(token, membership, choice);
      update(next);
      haptics.success();
      setDone(
        choice === "race_pass"
          ? raceId
            ? `Your race pass for ${raceName || "this race"} is active.`
            : "Race pass bought. Use it from any race page."
          : "You're on RunStride Plus."
      );
    } catch (e) {
      setError(e instanceof PurchasesUnavailable || e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Stack.Screen options={{ presentation: "modal", animation: "slide_from_bottom" }} />
        <Animated.View entering={ZoomIn.springify()}>
          <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.doneBadge}>
            <Ionicons name="checkmark" size={44} color={colors.heading} />
          </LinearGradient>
        </Animated.View>
        <Text style={styles.doneTitle}>{done}</Text>
        {membership?.testPurchases && <Text style={styles.testNote}>Test purchase: nothing was charged.</Text>}
        <View style={styles.doneButton}>
          <Button title="Done" onPress={close} />
        </View>
      </View>
    );
  }

  const option = (id: ProductId, name: string, price: string, per: string, note?: string) => {
    const selected = choice === id;
    return (
      <Pressable
        key={id}
        onPress={() => {
          haptics.tap();
          setChoice(id);
        }}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        style={hoverable(({ hovered }) => [styles.plan, hovered && styles.planHover, selected && styles.planSelected])}
      >
        {note ? (
          <View style={[styles.planNote, selected && styles.planNoteSelected]}>
            <Text style={styles.planNoteText}>{note}</Text>
          </View>
        ) : null}
        <Text style={styles.planName}>{name}</Text>
        <Text style={styles.planPrice}>{price}</Text>
        <Text style={styles.planPer}>{per}</Text>
      </Pressable>
    );
  };

  const credits = membership?.racePassCredits ?? 0;
  const actionTitle =
    choice === "race_pass"
      ? credits > 0 && raceId
        ? "Use my race pass here"
        : `Buy a race pass · ${RACE_PASS.price}`
      : `Get Plus · ${PLUS_PLANS.find((p) => p.id === choice)?.price}`;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: topPadding }]}>
      <Stack.Screen options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Pressable onPress={close} style={styles.close} accessibilityLabel="Close" hitSlop={10}>
        <Ionicons name="close" size={26} color={colors.textMuted} />
      </Pressable>

      <Animated.View entering={FadeInDown.duration(400)} style={styles.hero}>
        <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroBadge}>
          <Ionicons name="flash" size={30} color={colors.heading} />
        </LinearGradient>
        <Text style={styles.title}>RunStride Plus</Text>
        <Text style={styles.subtitle}>Meet more of the runners at your races, sooner.</Text>
      </Animated.View>

      {reason ? (
        <View style={styles.reason}>
          <Ionicons name="lock-closed" size={16} color={colors.primary} />
          <Text style={styles.reasonText}>{reason}</Text>
        </View>
      ) : null}

      {plus?.active ? (
        <View style={styles.current}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={styles.currentText}>
            You have Plus{plus.expiresAt ? ` until ${formatDate(plus.expiresAt)}` : ""}.
            {plus.source === "admin" ? " It was given to you by RunStride." : ""}
          </Text>
        </View>
      ) : null}
      {hasPassHere ? (
        <View style={styles.current}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={styles.currentText}>You have a race pass for {raceName || "this race"}.</Text>
        </View>
      ) : null}

      <View style={styles.features}>
        {PLUS_FEATURES.map((f, i) => (
          <Animated.View key={f.title} entering={FadeInDown.delay(100 + i * 50).duration(350)} style={styles.feature}>
            <View style={styles.featureIcon}>
              <Ionicons name={f.icon} size={18} color={colors.primary} />
            </View>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureBody}>{f.body}</Text>
            </View>
          </Animated.View>
        ))}
      </View>

      {!plus?.active && (
        <>
          <Text style={styles.section}>Choose a plan</Text>
          <View style={styles.plans}>{PLUS_PLANS.map((p) => option(p.id, p.name, p.price, p.per, p.note))}</View>
        </>
      )}

      {raceId && !plus?.active && !hasPassHere && (
        <>
          <Text style={styles.section}>Just this race</Text>
          {option(
            "race_pass",
            raceName ? `Race pass: ${raceName}` : RACE_PASS.name,
            credits > 0 ? "Already paid" : RACE_PASS.price,
            credits > 0 ? `You have ${credits} unused` : RACE_PASS.per
          )}
          <View style={styles.passFeatures}>
            {RACE_PASS_FEATURES.map((f) => (
              <Text key={f} style={styles.passFeature}>
                · {f}
              </Text>
            ))}
            <Text style={styles.passFeature}>· Lasts until the day after the race</Text>
          </View>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {!plus?.active && !(choice === "race_pass" && hasPassHere) && (
        <Button title={actionTitle} icon="flash" onPress={purchase} loading={busy} style={styles.buy} />
      )}
      {membership?.testPurchases ? (
        <Text style={styles.testNote}>Test mode: purchases are granted straight away and nothing is charged.</Text>
      ) : (
        <Text style={styles.small}>Subscriptions renew until you cancel in your App Store or Google Play settings.</Text>
      )}
      <Text style={styles.small}>
        ID verification, reporting, blocking and run-day safety are always free, for everyone.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  content: { padding: 20, paddingBottom: 48, maxWidth: 520, width: "100%", alignSelf: "center" },
  close: { alignSelf: "flex-end", padding: 4 },
  hero: { alignItems: "center", marginBottom: 18 },
  heroBadge: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { color: colors.heading, fontSize: 28, fontFamily: fonts.extrabold },
  subtitle: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 4 },
  reason: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  reasonText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  current: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  currentText: { color: colors.text, fontSize: 14, flex: 1 },
  features: { gap: 14, marginBottom: 22 },
  feature: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1 },
  featureTitle: { color: colors.heading, fontSize: 15, fontFamily: fonts.bold },
  featureBody: { color: colors.textMuted, fontSize: 13, marginTop: 1 },
  section: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.bold, marginBottom: 10, marginTop: 4 },
  plans: { flexDirection: "row", gap: 12, marginBottom: 16 },
  plan: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: "transparent",
    padding: 16,
    paddingTop: 22,
    alignItems: "center",
    marginBottom: 4,
  },
  planHover: { borderColor: colors.border },
  planSelected: { borderColor: colors.primary },
  planNote: {
    position: "absolute",
    top: -11,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  planNoteSelected: { backgroundColor: colors.primary },
  planNoteText: { color: colors.heading, fontSize: 11, fontFamily: fonts.bold },
  planName: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.semibold, textAlign: "center" },
  planPrice: { color: colors.heading, fontSize: 26, fontFamily: fonts.extrabold, marginTop: 4 },
  planPer: { color: colors.textFaint, fontSize: 12 },
  passFeatures: { marginTop: 8, marginBottom: 16, gap: 2 },
  passFeature: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.dangerText, fontSize: 14, textAlign: "center", marginBottom: 12 },
  buy: { marginTop: 4 },
  testNote: { color: colors.warningText, fontSize: 12, textAlign: "center", marginTop: 12 },
  small: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 17 },
  doneBadge: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", marginBottom: 20 },
  doneTitle: { color: colors.heading, fontSize: 22, fontFamily: fonts.bold, textAlign: "center", maxWidth: 360 },
  doneButton: { width: "100%", maxWidth: 320, marginTop: 28 },
});
