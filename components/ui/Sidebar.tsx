// Left-hand navigation used instead of the bottom tab bar on tablets in landscape, laptops and desktops.
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { colors, fonts, radius } from "../../lib/theme";
import { hoverable } from "../../lib/responsive";

export type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>["tabBar"]>>[0];

// Icons per tab route name, mirrors the bottom tab bar
type IconName = keyof typeof Ionicons.glyphMap;

export function Sidebar({ state, descriptors, navigation, compact }: TabBarProps & { compact?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, compact && styles.barCompact, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]}>
      <Image
        source={require("../../assets/logo.png")}
        style={compact ? styles.logoCompact : styles.logo}
        resizeMode="contain"
        accessibilityLabel="RunStride"
      />
      <View style={styles.items}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // Routes hidden with `href: null` (e.g. Moderation for non-admins)
          const itemStyle = StyleSheet.flatten(options.tabBarItemStyle);
          if (itemStyle?.display === "none") return null;

          const focused = state.index === index;
          const label = typeof options.title === "string" ? options.title : route.name;
          const badge = options.tabBarBadge;
          const color = focused ? colors.primary : colors.textMuted;
          const icon = options.tabBarIcon?.({ focused, color, size: 22 });

          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={hoverable(({ hovered, pressed }) => [
                styles.item,
                compact && styles.itemCompact,
                hovered && styles.itemHover,
                pressed && styles.itemPressed,
                focused && styles.itemActive,
              ])}
            >
              <View>
                {icon ?? <Ionicons name={"ellipse" as IconName} size={22} color={color} />}
                {compact && badge !== undefined ? <View style={styles.dot} /> : null}
              </View>
              {!compact ? (
                <>
                  <Text style={[styles.label, { color: focused ? colors.heading : colors.textMuted }]}>{label}</Text>
                  {badge !== undefined ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badge}</Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: 232,
    backgroundColor: colors.bg,
    borderRightWidth: 1,
    borderRightColor: colors.surface,
    paddingHorizontal: 14,
  },
  barCompact: { width: 76, paddingHorizontal: 10, alignItems: "center" },
  // The logo art is 364x343
  logo: { width: 72, height: 68, marginLeft: 10, marginBottom: 28 },
  logoCompact: { width: 44, height: 42, marginBottom: 24 },
  items: { gap: 4, alignSelf: "stretch" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.md,
  },
  itemCompact: { justifyContent: "center", paddingHorizontal: 0 },
  itemHover: { backgroundColor: colors.surface },
  itemPressed: { opacity: 0.8 },
  itemActive: { backgroundColor: colors.surface },
  label: { flex: 1, fontSize: 15, fontFamily: fonts.semibold },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.pink,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.heading, fontSize: 11, fontFamily: fonts.bold },
  dot: {
    position: "absolute",
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.pink,
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
