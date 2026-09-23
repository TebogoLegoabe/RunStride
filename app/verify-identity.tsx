import { View, Text, Pressable, StyleSheet, ActivityIndicator, AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ApiError, refreshVerification, startIdVerification } from "../lib/api";
import { getToken } from "../lib/session";
import type { VerificationState } from "../lib/types";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

export default function VerifyIdentity() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<VerificationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checking = useRef(false);

  const refresh = useCallback(
    async (t: string) => {
      if (checking.current) return;
      checking.current = true;
      try {
        const next = await refreshVerification(t);
        setState(next);
        setError(null);
        if (next.status === "verified") router.replace("/discover");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      } finally {
        checking.current = false;
      }
    },
    [router]
  );

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) {
        router.replace("/");
        return;
      }
      setToken(t);
      await refresh(t);
    })();
  }, [router, refresh]);

  // Coming back from Persona (closing the in-app browser, or switching back to this
  // tab on web) brings the app to the foreground: check for a result then.
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh(token);
    });
    return () => sub.remove();
  }, [token, refresh]);

  // While a decision is pending, keep checking in the background
  useEffect(() => {
    if (!token || state?.status !== "pending") return;
    const id = setInterval(() => refresh(token), 15_000);
    return () => clearInterval(id);
  }, [token, state?.status, refresh]);

  const handleStart = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const { verificationUrl } = await startIdVerification(token);
      await WebBrowser.openBrowserAsync(verificationUrl);
      await refresh(token);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <View style={[styles.container, styles.centered]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color="#4ecdc4" />}
      </View>
    );
  }

  const content = {
    unverified: {
      title: "Verify your identity",
      body:
        "Everyone on RunStride is ID-verified, so you always know the person you're meeting " +
        "for a run is who they say they are. It takes about 2 minutes: a photo of your ID " +
        "(smart ID card, green ID book or passport) and a quick selfie.",
      action: "Verify my ID",
    },
    pending: {
      title: "Checking your ID",
      body:
        "Thanks! Your verification is being reviewed. This usually takes a few minutes, " +
        "and occasionally longer if it needs a manual check.",
      action: null,
    },
    rejected: {
      title: "We couldn't verify your ID",
      body:
        state.attemptsRemaining > 0
          ? "This can happen if the photo was blurry, had glare, or the ID was partly cut off. " +
            `Please try again in good light. (${state.attemptsRemaining} ${
              state.attemptsRemaining === 1 ? "attempt" : "attempts"
            } left)`
          : "We weren't able to verify your ID after several attempts. " +
            "Please contact support and we'll help you sort it out.",
      action: "Try again",
    },
    verified: { title: "You're verified", body: "Taking you in...", action: null },
  }[state.status];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{content.title}</Text>
      <Text style={styles.body}>{content.body}</Text>

      {state.status === "unverified" && (
        <Text style={styles.privacy}>
          Your ID is checked by Persona, our verification partner. RunStride never stores
          your ID document; we only keep whether you passed.
        </Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {content.action && state.canStart && (
        <Pressable
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#0f172a" />
          ) : (
            <Text style={styles.primaryButtonText}>{content.action}</Text>
          )}
        </Pressable>
      )}

      {state.status !== "verified" && (
        <Pressable style={styles.linkButton} onPress={() => token && refresh(token)}>
          <Text style={styles.linkText}>Already finished? Check status</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    padding: 24,
    justifyContent: "center",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  centered: { alignItems: "center" },
  title: { fontSize: 26, fontWeight: "700", color: "#ffffff", marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, color: "#cbd5e1", marginBottom: 20 },
  privacy: { fontSize: 13, lineHeight: 19, color: "#94a3b8", marginBottom: 32 },
  error: { color: "#f87171", fontSize: 14, marginBottom: 16, textAlign: "center" },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#0f172a", fontSize: 16, fontWeight: "600" },
  linkButton: { marginTop: 20, alignItems: "center" },
  linkText: { color: "#94a3b8", fontSize: 14 },
});
