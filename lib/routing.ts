// Where a signed-in user belongs, based on how far through onboarding they are.
// Every screen that finishes a step asks this instead of hard-coding the next route.

import type { Href, useRouter } from "expo-router";
import type { Me } from "./types";

export function routeFor(me: Me): Href {
  if (!me.profileComplete) return "/profile-setup";
  if (me.verificationRequired && me.verificationStatus !== "verified") return "/verify-identity";
  if (!me.hasRunningProfile) return "/running-preferences";
  if (!me.hasDatingPreferences) return "/dating-preferences";
  return "/discover";
}

// After saving an onboarding screen: go back if the user came to edit it (e.g. from
// Profile), otherwise carry on to whichever step is next.
export function afterSave(router: ReturnType<typeof useRouter>, me: Me) {
  const next = routeFor(me);
  if (next === "/discover" && router.canGoBack()) router.back();
  else router.replace(next);
}
