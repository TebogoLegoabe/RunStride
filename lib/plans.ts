// What RunStride Plus and race passes include, and what they cost.
//
// PRICES ARE PLACEHOLDERS. The real prices are set per store in App Store Connect and Google
// Play; once purchases go through the stores, the store's own price replaces these.
import type { Ionicons } from "@expo/vector-icons";
import type { ProductId } from "./types";

type Icon = keyof typeof Ionicons.glyphMap;

export type Plan = { id: ProductId; name: string; price: string; per: string; note?: string };

export const PLUS_PLANS: Plan[] = [
  { id: "plus_monthly", name: "Monthly", price: "R129", per: "a month", note: "Best value" },
  { id: "plus_weekly", name: "Weekly", price: "R49", per: "a week", note: "Race week" },
];

export const RACE_PASS: Plan = { id: "race_pass", name: "Race pass", price: "R59", per: "one race" };

export const PLUS_FEATURES: { icon: Icon; title: string; body: string }[] = [
  { icon: "people", title: "Everyone going to your races", body: "See every runner, filtered by distance, age and pace." },
  { icon: "chatbubbles", title: "Say hi to anyone at a race", body: "Unlimited chat requests, not just one per race." },
  { icon: "flag", title: "Swipe runners at a race", body: "Discover only the people running the races you are." },
  { icon: "notifications", title: "Swap alerts", body: "Hear the moment an entry you need comes up." },
  { icon: "heart", title: "Unlimited likes, and see who likes you", body: "They're shown first in Discover." },
  { icon: "trending-up", title: "Be seen first", body: "Shown first to people going to the same races." },
];

export const RACE_PASS_FEATURES = [
  "Everyone going, with filters",
  "Unlimited chat requests",
  "Swipe only runners at this race",
  "Swap alerts, and your swap posts shown first",
];
