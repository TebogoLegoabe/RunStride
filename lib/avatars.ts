// Avatars: a picture to stand in for you when you'd rather not add a photo.
// The server sends "avatar:<name>" wherever it would send a photo. Names must match
// AVATARS in backend/app/avatars.py.
export const AVATARS = [
  { name: "cheetah", emoji: "🐆", color: "#f4a64f", label: "Cheetah" },
  { name: "springbok", emoji: "🦌", color: "#c98a4b", label: "Springbok" },
  { name: "lion", emoji: "🦁", color: "#e8b04a", label: "Lion" },
  { name: "zebra", emoji: "🦓", color: "#8f9bb3", label: "Zebra" },
  { name: "elephant", emoji: "🐘", color: "#7d8ca3", label: "Elephant" },
  { name: "giraffe", emoji: "🦒", color: "#d9a441", label: "Giraffe" },
  { name: "rhino", emoji: "🦏", color: "#8a8f98", label: "Rhino" },
  { name: "penguin", emoji: "🐧", color: "#4f8fd9", label: "Penguin" },
  { name: "flamingo", emoji: "🦩", color: "#e0489e", label: "Flamingo" },
  { name: "protea", emoji: "🌺", color: "#d9507a", label: "Protea" },
  { name: "shoe", emoji: "👟", color: "#3fae8f", label: "Running shoe" },
  { name: "medal", emoji: "🏅", color: "#5b6fd6", label: "Medal" },
  { name: "mountain", emoji: "⛰️", color: "#4e9a6b", label: "Mountain" },
  { name: "sunrise", emoji: "🌅", color: "#f47c4f", label: "Sunrise" },
  { name: "lightning", emoji: "⚡", color: "#6a4fd9", label: "Lightning" },
  { name: "flame", emoji: "🔥", color: "#c9453f", label: "Flame" },
] as const;

export type AvatarName = (typeof AVATARS)[number]["name"];

const PREFIX = "avatar:";

export const avatarRef = (name: string) => `${PREFIX}${name}`;

// The avatar a photo value stands for, or null when it's a real photo (or an avatar this
// version of the app doesn't know)
export function avatarFor(photo: string | null | undefined) {
  if (!photo || !photo.startsWith(PREFIX)) return null;
  return AVATARS.find((a) => a.name === photo.slice(PREFIX.length)) ?? null;
}

export const isAvatar = (photo: string | null | undefined) => !!photo && photo.startsWith(PREFIX);
