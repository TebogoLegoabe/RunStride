// Where a signed-in user belongs, based on how far through onboarding they are.
// Every screen that finishes a step asks this instead of hard-coding the next route.

import type { Href } from "expo-router";
import type { Me } from "./types";

export function routeFor(me: Me): Href<string> {
  if (!me.profileComplete) return "/profile-setup";
  if (me.verificationRequired && me.verificationStatus !== "verified") return "/verify-identity";
  return "/(app)";
}
