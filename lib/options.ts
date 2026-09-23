// Choices for running and dating preferences. Values must match the backend
// (Terrain, Goal, RunTime, Gender in backend/app/schemas.py); labels are display only.

export type Option<T extends string> = { value: T; label: string };

export const TERRAINS = [
  { value: "road", label: "Road" },
  { value: "trail", label: "Trail" },
  { value: "track", label: "Track" },
  { value: "treadmill", label: "Treadmill" },
] as const satisfies readonly Option<string>[];

export const GOALS = [
  { value: "social", label: "Social runs" },
  { value: "fitness", label: "Staying fit" },
  { value: "5k", label: "5K" },
  { value: "10k", label: "10K" },
  { value: "half_marathon", label: "Half marathon" },
  { value: "marathon", label: "Marathon" },
  { value: "ultra", label: "Ultra" },
] as const satisfies readonly Option<string>[];

export const RUN_TIMES = [
  { value: "early_morning", label: "Early morning" },
  { value: "morning", label: "Morning" },
  { value: "lunchtime", label: "Lunchtime" },
  { value: "evening", label: "Evening" },
] as const satisfies readonly Option<string>[];

export const GENDERS = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
] as const satisfies readonly Option<string>[];

// "Show me" uses plural labels for the same values
export const SHOW_ME = [
  { value: "woman", label: "Women" },
  { value: "man", label: "Men" },
  { value: "non_binary", label: "Non-binary people" },
] as const satisfies readonly Option<string>[];

export const DISTANCES_KM = [5, 10, 25, 50, 100] as const;

export type Terrain = (typeof TERRAINS)[number]["value"];
export type Goal = (typeof GOALS)[number]["value"];
export type RunTime = (typeof RUN_TIMES)[number]["value"];
export type Gender = (typeof GENDERS)[number]["value"];
