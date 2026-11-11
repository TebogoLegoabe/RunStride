// RunStride brand colors, taken from the logo. Every screen uses these names rather than
// raw hex values, so a color change here updates the whole app.
//
// Light and dark themes: the palette is picked once, synchronously, when this module is first
// evaluated. Screens capture `colors.x` in module-level StyleSheets, so switching theme saves
// the choice and reloads the app rather than re-rendering in place.

import { Appearance, DevSettings, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { reloadAppAsync } from "expo";

export type ThemePreference = "dark" | "light" | "system";
export type ColorScheme = "dark" | "light";

const PREFERENCE_KEY = "runstride.theme";

function readPreference(): ThemePreference {
  let stored: string | null = null;
  try {
    if (Platform.OS === "web") {
      // Also evaluated in Node during the static web export, where there is no window
      if (typeof window !== "undefined" && window.localStorage) stored = window.localStorage.getItem(PREFERENCE_KEY);
    } else {
      stored = SecureStore.getItem(PREFERENCE_KEY);
    }
  } catch {
    stored = null;
  }
  // Dark stays the default: it's what existing testers know
  return stored === "light" || stored === "system" ? stored : "dark";
}

function resolveScheme(pref: ThemePreference): ColorScheme {
  let resolved: ColorScheme = pref === "light" ? "light" : "dark";
  try {
    if (pref === "system") {
      // Clear any override from an earlier choice (it outlives a JS reload) before asking the phone
      if (Platform.OS !== "web") Appearance.setColorScheme("unspecified");
      resolved = Appearance.getColorScheme() === "light" ? "light" : "dark";
    } else if (Platform.OS !== "web") {
      // Native alerts, pickers and the keyboard follow the app's choice rather than the phone's
      Appearance.setColorScheme(pref);
    }
  } catch {
    // Appearance unavailable (static web export in Node): keep the default
  }
  return resolved;
}

export const themePreference: ThemePreference = readPreference();
export const scheme: ColorScheme = resolveScheme(themePreference);

// Saves the choice and reloads the app so every StyleSheet picks up the new palette.
export async function setThemePreference(pref: ThemePreference): Promise<void> {
  if (Platform.OS === "web") {
    try {
      window.localStorage.setItem(PREFERENCE_KEY, pref);
    } catch {
      // Storage blocked (private mode): nothing to remember, nothing to reload
      return;
    }
    window.location.reload();
    return;
  }
  await SecureStore.setItemAsync(PREFERENCE_KEY, pref);
  try {
    // Works in release builds too (expo-modules-core)
    await reloadAppAsync("Theme changed");
  } catch {
    DevSettings.reload();
  }
}

const dark = {
  // Surfaces, darkest to lightest (the logo's deep purple)
  bg: "#2e0444",
  surface: "#43105c",
  border: "#5c2378",
  borderStrong: "#7a4497",

  // Text on dark surfaces, dimmest to brightest
  textFaint: "#a88bbd", // placeholders, timestamps
  textMuted: "#cdb6dc", // secondary text
  text: "#eadff1", // body text
  textBright: "#f6f0fa",
  heading: "#ffffff",

  // Main accent (the logo's orange): buttons, links, highlights
  primary: "#f47c4f",
  onPrimary: "#2e0444", // text and icons on primary
  onPrimaryMuted: "#7a2f22", // secondary text on primary (e.g. time in your chat bubbles)
  primaryTint: "rgba(244, 124, 79, 0.16)",
  primaryTintSoft: "rgba(244, 124, 79, 0.1)",

  // The logo's pink, for romantic moments (likes, matches)
  pink: "#e0489e",
  pinkTint: "rgba(224, 72, 158, 0.15)",

  // Status. Danger stays a true red so the panic button never looks like a normal button.
  danger: "#ef4444",
  dangerText: "#f87171",
  dangerSoft: "#fecaca",
  dangerTint: "rgba(239, 68, 68, 0.18)",
  warning: "#f59e0b",
  warningText: "#fbbf24",
  warningSoft: "#fde68a",
  warningTint: "rgba(245, 158, 11, 0.14)",
  success: "#34d399",

  // Overlays
  backdrop: "rgba(20, 1, 30, 0.8)", // behind modals that hold a card/sheet
  backdropStrong: "rgba(20, 1, 30, 0.88)",
  overlay: "rgba(20, 1, 30, 0.88)", // full-screen panels with text drawn straight on them
  scrim: "rgba(46, 4, 68, 0.55)", // over photos, behind text
  scrimStrong: "rgba(46, 4, 68, 0.65)",
  scrimStronger: "rgba(46, 4, 68, 0.8)",
  photoBarDim: "rgba(255, 255, 255, 0.35)",

  // Fixed in both themes: text and icons drawn on photos, the brand gradient, pink, danger
  onPhoto: "#ffffff",
  onPhotoMuted: "#f6f0fa",
  onAccent: "#ffffff",
  primaryOnPhoto: "#f47c4f", // brand orange, 6.4:1 on the photo scrim
  pinkOnPhoto: "#e0489e", // brand pink, 4.6:1 on the photo scrim
};

export type Palette = { [K in keyof typeof dark]: string };

// Light: lavender page, white cards, deep-purple text. Orange and pink are darkened so they
// read as text on white, and white reads on them (see contrast notes in the theme PR).
const light: Palette = {
  bg: "#f6f1fa",
  surface: "#ffffff",
  border: "#e5d8ee",
  borderStrong: "#c9b2da",

  textFaint: "#7a6190", // 4.8:1 on bg
  textMuted: "#5c4470", // 7.5:1
  text: "#3a1f4f", // 12.7:1
  textBright: "#2e0444",
  heading: "#2e0444", // 15.5:1

  primary: "#c2511f", // 4.2:1 on bg, 4.7:1 on white
  onPrimary: "#ffffff", // 4.7:1 on primary
  onPrimaryMuted: "#ffe0d2", // 3.75:1 on primary
  primaryTint: "rgba(194, 81, 31, 0.12)",
  primaryTintSoft: "rgba(194, 81, 31, 0.07)",

  pink: "#c93088", // 4.4:1 on bg; white on it 4.9:1
  pinkTint: "rgba(201, 48, 136, 0.12)",

  danger: "#dc2626", // white on it 4.8:1
  dangerText: "#b91c1c", // 5.8:1 on bg
  dangerSoft: "#991b1b", // text on dangerTint
  dangerTint: "rgba(220, 38, 38, 0.1)",
  warning: "#d97706",
  warningText: "#a14c06", // 5.3:1 on bg
  warningSoft: "#8a4206", // text on warningTint
  warningTint: "rgba(217, 119, 6, 0.12)",
  success: "#047857", // 4.9:1 on bg

  backdrop: "rgba(46, 4, 68, 0.45)",
  backdropStrong: "rgba(46, 4, 68, 0.6)",
  overlay: "rgba(246, 241, 250, 0.97)",
  // Scrims sit on photos under white text, so they stay dark
  scrim: "rgba(46, 4, 68, 0.55)",
  scrimStrong: "rgba(46, 4, 68, 0.65)",
  scrimStronger: "rgba(46, 4, 68, 0.8)",
  photoBarDim: "rgba(255, 255, 255, 0.35)",

  onPhoto: "#ffffff",
  onPhotoMuted: "#f6f0fa",
  onAccent: "#ffffff",
  primaryOnPhoto: "#f47c4f", // brand orange, 6.4:1 on the photo scrim
  pinkOnPhoto: "#e0489e", // brand pink, 4.6:1 on the photo scrim
};

export const colors: Palette = scheme === "light" ? light : dark;

// The logo's gradient: pink at the top of the hexagon, coral at the bottom
export const gradient = {
  brand: ["#d63c97", "#f0605a", "#f47c4f"] as const,
  // Subtle glow for backgrounds behind hero content
  glow:
    scheme === "light"
      ? (["rgba(214, 60, 151, 0.16)", "rgba(246, 241, 250, 0)"] as const)
      : (["rgba(214, 60, 151, 0.35)", "rgba(46, 4, 68, 0)"] as const),
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

// Plus Jakarta Sans, one family per weight (Android needs a separate font file per weight)
export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
} as const;

const shadowColor = scheme === "light" ? "#2e0444" : "#0b0012";

export const shadow = {
  card: {
    shadowColor,
    shadowOpacity: scheme === "light" ? 0.12 : 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: scheme === "light" ? 6 : 10,
  },
  soft: {
    shadowColor,
    shadowOpacity: scheme === "light" ? 0.08 : 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: scheme === "light" ? 2 : 4,
  },
};
