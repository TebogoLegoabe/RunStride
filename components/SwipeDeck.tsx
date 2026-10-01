// Swipeable stack of runner cards: drag right to like, left to pass. The like/pass buttons
// drive the same animation through the deck's ref.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { RunnerCard } from "./RunnerCard";
import { haptics } from "../lib/haptics";
import { colors, shadow } from "../lib/theme";
import type { DiscoverCard, RunningProfile } from "../lib/types";

// How far (px) or how fast (px/s) a drag must go to count as a decision
const DISTANCE_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 900;
const FLY_OUT_MS = 230;

export type SwipeDeckHandle = { swipe: (liked: boolean) => void };

type Props = {
  cards: DiscoverCard[];
  mine: RunningProfile | null;
  onSwiped: (card: DiscoverCard, liked: boolean) => void;
  onOptions: (card: DiscoverCard) => void;
};

type CardHandle = { fling: (liked: boolean) => void };

type SwipeCardProps = {
  card: DiscoverCard;
  mine: RunningProfile | null;
  isTop: boolean;
  onSwiped: (liked: boolean) => void;
  onOptions: () => void;
};

const SwipeCard = forwardRef<CardHandle, SwipeCardProps>(function SwipeCard(
  { card, mine, isTop, onSwiped, onOptions },
  ref
) {
  const { width: windowWidth } = useWindowDimensions();
  // Tilt and fly-out distance follow the card's scale, not a wide desktop window
  const width = Math.min(windowWidth, 560);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Cards waiting underneath sit slightly smaller and rise into place when they reach the top
  const lift = useSharedValue(isTop ? 1 : 0);

  useEffect(() => {
    lift.value = withSpring(isTop ? 1 : 0, { damping: 16, stiffness: 180 });
  }, [isTop, lift]);

  const finish = (liked: boolean) => {
    if (liked) haptics.like();
    else haptics.pass();
    onSwiped(liked);
  };

  const fling = (liked: boolean) => {
    const off = (liked ? 1 : -1) * windowWidth;
    x.value = withTiming(off, { duration: FLY_OUT_MS }, (done) => {
      if (done) runOnJS(finish)(liked);
    });
  };

  useImperativeHandle(ref, () => ({ fling }));

  const pan = Gesture.Pan()
    .enabled(isTop)
    // Only a clearly sideways drag swipes; vertical scrolling and photo taps still work
    .activeOffsetX([-14, 14])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY * 0.25;
    })
    .onEnd((e) => {
      const decided = Math.abs(e.translationX) > DISTANCE_THRESHOLD || Math.abs(e.velocityX) > VELOCITY_THRESHOLD;
      if (decided) {
        const liked = (Math.abs(e.velocityX) > VELOCITY_THRESHOLD ? e.velocityX : e.translationX) > 0;
        x.value = withTiming((liked ? 1 : -1) * windowWidth, { duration: FLY_OUT_MS }, (done) => {
          if (done) runOnJS(finish)(liked);
        });
      } else {
        x.value = withSpring(0, { damping: 15, stiffness: 200 });
      }
      y.value = withSpring(0);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value + interpolate(lift.value, [0, 1], [18, 0]) },
      { rotate: `${interpolate(x.value, [-width, width], [-14, 14], Extrapolation.CLAMP)}deg` },
      { scale: interpolate(lift.value, [0, 1], [0.94, 1]) },
    ],
  }));
  const likeStamp = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [20, DISTANCE_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const passStamp = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-DISTANCE_THRESHOLD, -20], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[isTop ? styles.top : styles.under, cardStyle]}
        pointerEvents={isTop ? "auto" : "none"}
      >
        <RunnerCard card={card} mine={mine} onOptions={onOptions} />
        <Animated.View style={[styles.stamp, styles.likeStamp, likeStamp]} pointerEvents="none">
          <Ionicons name="heart" size={22} color={colors.pink} />
          <Text style={[styles.stampText, { color: colors.pink }]}>LIKE</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.passStamp, passStamp]} pointerEvents="none">
          <Ionicons name="close" size={22} color={colors.textBright} />
          <Text style={[styles.stampText, { color: colors.textBright }]}>NOPE</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

export const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(function SwipeDeck(
  { cards, mine, onSwiped, onOptions },
  ref
) {
  const topRef = useRef<CardHandle>(null);
  useImperativeHandle(ref, () => ({ swipe: (liked) => topRef.current?.fling(liked) }));

  // Render the top card plus the next one underneath; the rest mount as the deck moves
  const visible = cards.slice(0, 2);
  return (
    <View style={styles.deck}>
      {visible
        .map((card, index) => (
          <SwipeCard
            key={card.userId}
            ref={index === 0 ? topRef : undefined}
            card={card}
            mine={mine}
            isTop={index === 0}
            onSwiped={(liked) => onSwiped(card, liked)}
            onOptions={() => onOptions(card)}
          />
        ))
        .reverse()}
    </View>
  );
});

const styles = StyleSheet.create({
  deck: { width: "100%", maxWidth: 420, alignSelf: "center" },
  top: { width: "100%", zIndex: 2, borderRadius: 20, ...shadow.card },
  // The next card waits underneath, cut to the top card's height so a longer bio can't poke out
  under: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1, overflow: "hidden", borderRadius: 20 },
  stamp: {
    position: "absolute",
    top: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 3,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.scrimStrong,
  },
  likeStamp: { left: 18, borderColor: colors.pink, transform: [{ rotate: "-14deg" }] },
  passStamp: { right: 18, borderColor: colors.textBright, transform: [{ rotate: "14deg" }] },
  stampText: { fontSize: 24, fontWeight: "800", letterSpacing: 2 },
});
