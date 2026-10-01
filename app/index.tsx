import { View, StyleSheet, Image } from "react-native";
import { useEffect } from "react";
import { useRouter } from "expo-router";
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../components/ui/Text";
import { Button } from "../components/ui/Button";
import { ApiError, getMe } from "../lib/api";
import { routeFor } from "../lib/routing";
import { clearToken, getToken } from "../lib/session";
import { colors, fonts, gradient } from "../lib/theme";

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: "speedometer", title: "Match on pace", body: "Meet people who run like you do." },
  { icon: "flag", title: "Meet at races", body: "See who's running your next race." },
  { icon: "shield-checkmark", title: "Built for safety", body: "Verified profiles and live run sharing." },
];

export default function Welcome() {
  const router = useRouter();
  const logoScale = useSharedValue(0.8);
  const logoOpacity = useSharedValue(0);
  const float = useSharedValue(0);

  // Already signed in: skip straight to wherever onboarding left off
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return;
      try {
        router.replace(routeFor(await getMe(token)));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await clearToken();
        // Suspended or banned: the signed-in area explains why
        if (e instanceof ApiError && e.status === 403) router.replace("/discover");
      }
    })();
  }, [router]);

  // The logo springs in, then floats gently
  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 500 });
    logoScale.value = withSpring(1, { damping: 12, stiffness: 90 });
    float.value = withDelay(
      700,
      withRepeat(
        withSequence(
          withTiming(-8, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.sin) })
        ),
        -1
      )
    );
  }, [logoOpacity, logoScale, float]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }, { translateY: float.value }],
  }));

  return (
    <View style={styles.container}>
      <LinearGradient colors={gradient.glow} style={styles.glow} pointerEvents="none" />
      <View style={styles.content}>
        <Animated.View style={logoStyle}>
          <Image
            source={require("../assets/logo.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="RunStride"
          />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(300).duration(500)} style={styles.tagline}>
          Find someone who runs at your pace.
        </Animated.Text>

        <View style={styles.features}>
          {FEATURES.map((f, i) => (
            <Animated.View key={f.title} entering={FadeInDown.delay(500 + i * 120).duration(450)} style={styles.feature}>
              <LinearGradient colors={gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featureIcon}>
                <Ionicons name={f.icon} size={18} color={colors.heading} />
              </LinearGradient>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>

      <Animated.View entering={FadeInDown.delay(950).duration(500)} style={styles.bottom}>
        <Button title="Get started" icon="arrow-forward" onPress={() => router.push("/signup")} />
        <Text style={styles.legal}>Sign up or log in with your phone number.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "space-between" },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: "55%" },
  content: { flex: 1, alignItems: "center", justifyContent: "center", width: "100%", maxWidth: 420, alignSelf: "center" },
  // The logo art is 364x343; keep that shape
  logo: { width: 210, height: 198 },
  tagline: {
    color: colors.textBright,
    fontSize: 18,
    textAlign: "center",
    marginTop: 18,
    marginBottom: 32,
    fontFamily: fonts.semibold,
  },
  features: { alignSelf: "stretch", gap: 14 },
  feature: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  featureText: { flex: 1 },
  featureTitle: { color: colors.heading, fontSize: 15, fontWeight: "700" },
  featureBody: { color: colors.textMuted, fontSize: 13, marginTop: 1 },
  bottom: { width: "100%", maxWidth: 420, alignSelf: "center", paddingBottom: 12 },
  legal: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 12 },
});
