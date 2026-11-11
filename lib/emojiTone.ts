// The pure part of emoji skin tones (no React Native), so it can be tested on its own.

// "" is the default yellow
export const SKIN_TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

// Emoji (as their first character) that take a skin tone. Others are left as they are.
const TONEABLE = new Set(
  ["🏃", "💪", "👏", "🙌", "👍", "👎", "🙏", "✌", "🤞", "👌", "🤙", "👋", "🫶", "🤟", "👊", "✋", "🤚", "👆", "☝", "🤘", "🫰"].map(
    (e) => e.codePointAt(0)!
  )
);

// 🏃 + 🏽 → 🏃🏽, and 🏃‍♀️ → 🏃🏽‍♀️ (the tone goes straight after the person, before the rest)
export function withTone(emoji: string, tone: SkinTone): string {
  const first = emoji.codePointAt(0);
  if (!tone || first === undefined || !TONEABLE.has(first)) return emoji;
  const base = String.fromCodePoint(first);
  const rest = emoji.slice(base.length).replace(/^️/, ""); // the tone replaces the "show as emoji" mark
  return base + tone + rest;
}
