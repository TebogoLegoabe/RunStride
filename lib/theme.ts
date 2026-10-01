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
