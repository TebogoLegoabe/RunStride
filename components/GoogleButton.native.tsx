// "Continue with Google" on phones: Google's own sign-in sheet inside the app (no browser, no redirect).
// It returns a Google ID token, which the API checks before trusting it.
//
// Android needs: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (the token is issued for it) and an Android OAuth client in
// Google Cloud with this app's package name and signing SHA-1. A development or store build is required:
// Google sign-in doesn't run in Expo Go. iOS stays hidden until its client ID and URL scheme are set up.
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View, ActivityIndicator } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { hoverable } from "../lib/responsive";
import { colors, fonts, radius } from "../lib/theme";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

// Whether Google sign-in can work here
export function googleAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  if (!WEB_CLIENT_ID) return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

type Props = {
  title?: string;
  busy?: boolean;
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
};

let configured = false;

// The library isn't in Expo Go, so it's loaded only when the button is pressed
function googleSignIn() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lib = require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
  if (!configured) {
    lib.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
    configured = true;
  }
  return lib;
}

// Render only when googleAvailable()
export function GoogleButton({ title = "Continue with Google", busy, onIdToken, onError }: Props) {
  const [working, setWorking] = useState(false);

  const press = async () => {
    setWorking(true);
    try {
      const { GoogleSignin, isErrorWithCode, statusCodes } = googleSignIn();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      // Forget the last account so people can pick which one to use
      await GoogleSignin.signOut().catch(() => undefined);
      const result = await GoogleSignin.signIn();
      if (result.type === "cancelled") return;
      const idToken = result.data.idToken;
      if (idToken) onIdToken(idToken);
      else onError("Google didn't send back your sign-in. Please try again.");
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const lib = require("@react-native-google-signin/google-signin") as typeof import("@react-native-google-signin/google-signin");
      if (lib.isErrorWithCode(e)) {
        if (e.code === lib.statusCodes.SIGN_IN_CANCELLED) return;
        if (e.code === lib.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          onError("Google Play services aren't available on this phone.");
          return;
        }
        onError(`Google sign-in didn't work (${e.code}). Please try again.`);
      } else {
        onError("Google sign-in didn't work. Please try again.");
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Pressable
      onPress={press}
      disabled={busy || working}
      accessibilityRole="button"
      style={hoverable(({ hovered, pressed }) => [
        styles.button,
        (hovered || pressed) && styles.buttonActive,
        (busy || working) && styles.disabled,
      ])}
    >
      {busy || working ? (
        <ActivityIndicator color={colors.bg} />
      ) : (
        <View style={styles.inner}>
          <Ionicons name="logo-google" size={18} color={colors.bg} />
          <Text style={styles.text}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.heading,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonActive: { opacity: 0.9 },
  disabled: { opacity: 0.6 },
  inner: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { color: colors.bg, fontSize: 16, fontFamily: fonts.bold },
});
