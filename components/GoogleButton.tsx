// "Continue with Google". Gets a Google ID token, which the API checks before trusting it.
//
// Needs the OAuth client IDs from Google Cloud in .env:
//   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
// On phones it needs a development or store build: Google doesn't allow sign-in from Expo Go.
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View, ActivityIndicator } from "react-native";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./ui/Text";
import { hoverable } from "../lib/responsive";
import { colors, fonts, radius } from "../lib/theme";

// Finishes the sign-in popup on the web
WebBrowser.maybeCompleteAuthSession();

const CLIENT_IDS = {
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
};

// Whether Google sign-in can work here
export function googleAvailable(): boolean {
  const clientId = CLIENT_IDS[Platform.OS as keyof typeof CLIENT_IDS];
  if (!clientId) return false;
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

type Props = {
  title?: string;
  busy?: boolean;
  onIdToken: (idToken: string) => void;
  onError: (message: string) => void;
};

// Render only when googleAvailable(): the sign-in hook needs this platform's client ID
export function GoogleButton({ title = "Continue with Google", busy, onIdToken, onError }: Props) {
  const [request, response, prompt] = Google.useIdTokenAuthRequest({
    webClientId: CLIENT_IDS.web,
    iosClientId: CLIENT_IDS.ios,
    androidClientId: CLIENT_IDS.android,
    selectAccount: true,
  });

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params.id_token;
      if (idToken) onIdToken(idToken);
      else onError("Google didn't send back your sign-in. Please try again.");
    } else if (response?.type === "error") {
      onError("Google sign-in didn't work. Please try again.");
    }
    // onIdToken/onError change every render; only a new response matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <Pressable
      onPress={() => prompt()}
      disabled={!request || busy}
      accessibilityRole="button"
      style={hoverable(({ hovered, pressed }) => [
        styles.button,
        (hovered || pressed) && styles.buttonActive,
        (!request || busy) && styles.disabled,
      ])}
    >
      {busy ? (
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
