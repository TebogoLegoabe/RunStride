// "It's a match!": both photos swing in, a heart pops between them, then the actions fade up.
import { useEffect } from "react";
import { Image, Modal, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { Button } from "./ui/Button";
import { mediaUrl } from "../lib/api";
import { haptics } from "../lib/haptics";
import { colors, gradient, shadow } from "../lib/theme";
import type { MatchSummary } from "../lib/types";

type Props = {
  match: MatchSummary | null;
  myPhoto: string | null;
  onMessage: () => void;
  onClose: () => void;
};

function Photo({ uri, side }: { uri: string | null; side: "left" | "right" }) {
  const from = side === "left" ? -1 : 1;
  const x = useSharedValue(from * 160);
  const rotate = useSharedValue(from * 24);
  useEffect(() => {
    x.value = withSpring(0, { damping: 13, stiffness: 120 });
    rotate.value = withSpring(from * 8, { damping: 11, stiffness: 110 });
  }, [x, rotate, from]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: `${rotate.value}deg` }],
  }));
  return (
    <Animated.View style={[styles.photoFrame, shadow.card, style]}>
      {uri ? <Image source={{ uri: mediaUrl(uri) }} style={styles.photo} /> : <View style={[styles.photo, styles.photoEmpty]} />}
    </Animated.View>
  );
}

export function MatchCelebration({ match, myPhoto, onMessage, onClose }: Props) {
  const heart = useSharedValue(0);

  useEffect(() => {
    if (!match) return;
    haptics.success();
    heart.value = 0;
    heart.value = withDelay(350, withSequence(withSpring(1.35, { damping: 6 }), withSpring(1, { damping: 10 })));
  }, [match, heart]);

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heart.value }], opacity: Math.min(heart.value, 1) }));

  return (
    <Modal visible={match !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <LinearGradient colors={gradient.glow} style={styles.glow} pointerEvents="none" />
        {match && (
          <>
            <Animated.View entering={FadeIn.duration(300)}>
              <Text style={styles.title}>It's a match!</Text>
            </Animated.View>
            <View style={styles.photos}>
              <Photo uri={myPhoto} side="left" />
              <Photo uri={match.photo} side="right" />
              <Animated.View style={[styles.heartWrap, heartStyle]}>
                <LinearGradient colors={gradient.brand} style={styles.heart}>
                  <Ionicons name="heart" size={30} color={colors.heading} />
                </LinearGradient>
              </Animated.View>
            </View>
            <Animated.View entering={FadeInDown.delay(500).duration(400)} style={styles.bottom}>
              <Text style={styles.body}>
                You and {match.displayName} like each other. Say hi and plan your first run together.
              </Text>
              <Button title="Send a message" icon="chatbubble-ellipses" onPress={onMessage} />
              <Button title="Keep discovering" variant="ghost" onPress={onClose} style={styles.secondary} />
            </Animated.View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdropStrong, alignItems: "center", justifyContent: "center", padding: 24 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: "60%" },
  title: { color: colors.heading, fontSize: 38, fontWeight: "800", textAlign: "center", marginBottom: 28, letterSpacing: -0.5 },
  photos: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 32 },
  photoFrame: { borderRadius: 22, borderWidth: 3, borderColor: colors.heading, marginHorizontal: -10, backgroundColor: colors.surface },
  photo: { width: 132, height: 170, borderRadius: 19 },
  photoEmpty: { backgroundColor: colors.border },
  heartWrap: { position: "absolute", bottom: -22 },
  heart: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.bg },
  bottom: { width: "100%", maxWidth: 380 },
  body: { color: colors.text, fontSize: 16, lineHeight: 23, textAlign: "center", marginBottom: 22 },
  secondary: { marginTop: 6 },
});
