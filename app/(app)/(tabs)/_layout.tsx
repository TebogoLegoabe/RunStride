import { Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { getMe } from "../../../lib/api";
import { useChat } from "../../../components/ChatProvider";

export default function TabsLayout() {
  const { token, unreadTotal } = useChat();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (token) getMe(token).then((me) => setIsAdmin(me.isAdmin)).catch(() => {});
  }, [token]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#4ecdc4",
        tabBarInactiveTintColor: "#64748b",
        tabBarStyle: { backgroundColor: "#0f172a", borderTopColor: "#1e293b" },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ color, size }) => <Ionicons name="compass" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="matches"
        options={{
          title: "Matches",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} />,
          tabBarBadge: unreadTotal > 0 ? unreadTotal : undefined,
          tabBarBadgeStyle: { backgroundColor: "#4ecdc4", color: "#0f172a" },
        }}
      />
      <Tabs.Screen
        name="moderation"
        options={{
          title: "Moderation",
          // Only admins see this tab; the API checks too
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
