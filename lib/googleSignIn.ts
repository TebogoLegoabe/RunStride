// After Google hands back an ID token: sign in to RunStride and go to the right onboarding step.
import type { useRouter } from "expo-router";
import { getMe, googleSignIn } from "./api";
import { routeFor } from "./routing";
import { saveToken } from "./session";

export async function finishGoogleSignIn(router: ReturnType<typeof useRouter>, idToken: string) {
  const res = await googleSignIn(idToken);
  await saveToken(res.token);
  const next = routeFor(await getMe(res.token));
  // New accounts: start the profile with their name from Google
  if (next === "/profile-setup" && res.suggestedName) {
    router.replace({ pathname: "/profile-setup", params: { name: res.suggestedName } });
  } else {
    router.replace(next);
  }
}
