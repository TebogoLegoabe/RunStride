// Page wrapper: brand background, room for the phone's notch / status bar, and content held
// to a readable width on tablets and desktops instead of stretching edge to edge.
import { ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../lib/theme";
import { CONTENT_WIDTH, useBreakpoint } from "../../lib/responsive";

type Props = {
  children: React.ReactNode;
  // narrow: forms and onboarding. normal: lists and detail pages. wide: grids and split views.
  width?: keyof typeof CONTENT_WIDTH;
  scroll?: boolean;
  // Extra space under the safe area at the top
  topGap?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
};

export function Screen({
  children,
  width = "normal",
  scroll = false,
  topGap = 12,
  style,
  contentStyle,
  keyboardShouldPersistTaps = "handled",
}: Props) {
  const insets = useSafeAreaInsets();
  const { isPhone, isDesktop } = useBreakpoint();
  // Phones: edge-to-edge with a 16pt gutter. Bigger screens: more breathing room.
  const gutter = isPhone ? 16 : isDesktop ? 32 : 24;
  const padding = {
    paddingTop: insets.top + topGap + (isPhone ? 0 : 12),
    paddingHorizontal: gutter,
    paddingBottom: insets.bottom + 24,
  };
  const column = [styles.column, { maxWidth: CONTENT_WIDTH[width] }, contentStyle];

  if (scroll) {
    return (
      <ScrollView
        style={[styles.screen, style]}
        contentContainerStyle={[padding, styles.grow]}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      >
        <View style={column}>{children}</View>
      </ScrollView>
    );
  }
  return (
    <View style={[styles.screen, padding, style]}>
      <View style={[column, styles.fill]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  grow: { flexGrow: 1 },
  column: { width: "100%", alignSelf: "center" },
  fill: { flex: 1 },
});
