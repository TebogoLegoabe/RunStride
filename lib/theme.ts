// RunStride brand colors, taken from the logo. Every screen uses these names rather than
// raw hex values, so a color change here updates the whole app.

export const colors = {
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

  // Overlays
  backdrop: "rgba(20, 1, 30, 0.8)", // behind modals
  backdropStrong: "rgba(20, 1, 30, 0.88)",
  scrim: "rgba(46, 4, 68, 0.55)", // over photos, behind text
  scrimStrong: "rgba(46, 4, 68, 0.65)",
  scrimStronger: "rgba(46, 4, 68, 0.8)",
  photoBarDim: "rgba(255, 255, 255, 0.35)",
} as const;

// The logo's gradient: pink at the top of the hexagon, coral at the bottom
export const gradient = {
  brand: ["#d63c97", "#f0605a", "#f47c4f"] as const,
  // Subtle glow for backgrounds behind hero content
  glow: ["rgba(214, 60, 151, 0.35)", "rgba(46, 4, 68, 0)"] as const,
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

export const shadow = {
  card: {
    shadowColor: "#0b0012",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  soft: {
    shadowColor: "#0b0012",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
} as const;
