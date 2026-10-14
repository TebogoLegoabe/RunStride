import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

// Google sends people back to the app through this address. The sign-in itself is finished by
// GoogleButton; this only stops the router from showing "Unmatched Route" and returns to the previous screen.
export default function OAuthRedirect() {
  const router = useRouter();
  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);
  return null;
}
