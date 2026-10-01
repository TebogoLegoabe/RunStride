import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { getMe } from "../../../lib/api";
import { useChat } from "../../../components/ChatProvider";
import { Sidebar } from "../../../components/ui/Sidebar";
import { useBreakpoint } from "../../../lib/responsive";
import { colors, fonts } from "../../../lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;

// Outline when idle, filled when selected, with a small bounce as it becomes selected
function TabIcon({ name, focused, color, size }: { name: string; focused: boolean; color: ColorValue; size: number }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) scale.value = withSequence(withSpring(1.18, { damping: 8 }), withSpring(1, { damping: 12 }));
  }, [focused, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const icon = (focused ? name : `${name}-outline`) as IconName;
  return (
    <Animated.View style={style}>
      <Ionicons name={icon} color={color} size={size} />
    </Animated.View>
  );
}

const icon =
  (name: string) =>
  ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <TabIcon name={name} focused={focused} color={color} size={size} />
  );

export default function TabsLayout() {
  const { token, unreadTotal, mentionTotal } = useChat();
  const [isAdmin, setIsAdmin] = useState(false);
  const { isTablet, isDesktop, isWide } = useBreakpoint();
  const insets = useSafeAreaInsets();
  // Bottom tabs on phones; a side rail on tablets and a full sidebar on laptops and desktops
  const side = isDesktop || isTablet;

  useEffect(() => {
    if (token) getMe(token).then((me) => setIsAdmin(me.isAdmin)).catch(() => {});
  }, [token]);

  return (
    <Tabs
      tabBar={side ? (props) => <Sidebar {...props} compact={!isWide} /> : undefined}
      screenOptions={{
        tabBarPosition: side ? "left" : "bottom",
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11 },
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.surface,
          // Room for the home indicator on iPhones and gesture bar on Android
          height: 64 + Math.max(insets.bottom, 8),
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 8) + 4,
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: icon("compass") }} />
      <Tabs.Screen
        name="races"
        options={{
          title: "Races",
          tabBarIcon: icon("flag"),
          // Someone @mentioned you in a race chat
          tabBarBadge: mentionTotal > 0 ? `@${mentionTotal}` : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.pink, color: colors.heading, fontFamily: fonts.bold, fontSize: 11 },
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: "Matches",
          tabBarIcon: icon("chatbubbles"),
          tabBarBadge: unreadTotal > 0 ? unreadTotal : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.pink, color: colors.heading, fontFamily: fonts.bold, fontSize: 11 },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: icon("person-circle") }} />
      <Tabs.Screen
        name="moderation"
        options={{
          title: "Moderation",
          // Only admins see this tab; the API checks too
          href: isAdmin ? undefined : null,
          tabBarIcon: icon("shield-checkmark"),
        }}
      />
    </Tabs>
  );
}
