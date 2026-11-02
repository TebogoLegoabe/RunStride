// Where a signed-in user belongs, based on how far through onboarding they are.
// Every screen that finishes a step asks this instead of hard-coding the next route.

import type { Href, useRouter } from "expo-router";
import type { Me } from "./types";

export function routeFor(me: Me): Href {
  // Signed in with Google only: add a phone number first (joins an existing account with that number)
  if (!me.phone) return "/add-phone";
  if (!me.profileComplete) return "/profile-setup";
  if (me.verificationRequired && me.verificationStatus !== "verified") return "/verify-identity";
  if (!me.hasRunningProfile) return "/running-preferences";
  if (!me.hasDatingPreferences) return "/dating-preferences";
  return "/discover";
}

// After saving an onboarding screen: go back if the user opened it to edit (from Profile or
// Discover, with ?edit=1), otherwise carry on to whichever step is next. "Can go back" alone
// isn't enough: someone finishing sign-up can go back too, to the phone number screen.
export function afterSave(router: ReturnType<typeof useRouter>, me: Me, editing = false) {
  const next = routeFor(me);
  if (editing && next === "/discover" && router.canGoBack()) router.back();
  else router.replace(next);
}

// Opens an onboarding screen to change what was saved, coming back here afterwards
export const editHref = (path: "/profile-setup" | "/running-preferences" | "/dating-preferences") =>
  `${path}?edit=1` as Href;
