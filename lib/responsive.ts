// Screen-size breakpoints, shared by every screen so layouts change at the same widths.
import { useWindowDimensions, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type Breakpoint = "phone" | "tablet" | "desktop";

// Widths in points (CSS pixels on the web)
export const BREAKPOINTS = { tablet: 640, desktop: 1024 } as const;

// Comfortable reading widths for content columns
export const CONTENT_WIDTH = { narrow: 480, normal: 640, wide: 1100 } as const;

export function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINTS.desktop) return "desktop";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "phone";
}

export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  const breakpoint = breakpointFor(width);
  return {
    breakpoint,
    width,
    height,
    isPhone: breakpoint === "phone",
    isTablet: breakpoint === "tablet",
    isDesktop: breakpoint === "desktop",
    // Tablets in landscape and desktops have room for two panes side by side
    isWide: width >= 900,
  };
}

// Space above a screen's content: clears the notch / status bar on phones, a little extra
// breathing room on bigger screens. Use instead of a fixed paddingTop.
export function useTopPadding(extra = 12) {
  const insets = useSafeAreaInsets();
  const { isPhone } = useBreakpoint();
  return Math.max(insets.top, isPhone ? 24 : 0) + extra + (isPhone ? 0 : 16);
}

// Pressable styles that react to the mouse on the web. react-native-web passes `hovered`
// to Pressable's style callback; React Native's types don't include it. Never set on phones.
export type PressState = PressableStateCallbackType & { hovered?: boolean };
export function hoverable(style: (state: PressState) => StyleProp<ViewStyle>) {
  return style as (state: PressableStateCallbackType) => StyleProp<ViewStyle>;
}

// Width of the navigation beside the content (see components/ui/Sidebar.tsx); 0 on phones
export const SIDEBAR_WIDTH = { full: 232, compact: 76 } as const;

// How many grid columns fit in the content area, given the narrowest a column may be
export function useColumns(minColumnWidth: number, maxColumns = 3) {
  const { width, isPhone, isWide } = useBreakpoint();
  if (isPhone) return 1;
  const nav = isWide ? SIDEBAR_WIDTH.full : SIDEBAR_WIDTH.compact;
  const available = Math.min(width - nav - 48, CONTENT_WIDTH.wide);
  return Math.max(1, Math.min(maxColumns, Math.floor(available / minColumnWidth)));
}
