import { Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text, TextInput } from "../components/ui/Text";
import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, addPhone, getMe, sendOtp } from "../lib/api";
import { routeFor } from "../lib/routing";
import { getToken, saveToken } from "../lib/session";
import { colors } from "../lib/theme";
import { AuthCard } from "../components/ui/AuthCard";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

// Accounts that signed in with Google add a phone number too, so everyone has both. If the number already
// belongs to a RunStride account, the two are joined and nothing is duplicated.
export default function AddPhone() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null); // the normalised number, once a code is sent
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getToken().then((t) => (t ? setToken(t) : router.replace("/")));
  }, [router]);

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await sendOtp(phone.trim());
      setSentTo(res.phone);
      setCode("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!token || !sentTo) return;
    setError(null);
    setBusy(true);
    try {
      const res = await addPhone(token, sentTo, code);
      await saveToken(res.token); // the phone account's token, if the two were joined
      router.replace(routeFor(await getMe(res.token)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  // Autofilled from the text message, or typed: no need to press a button
  useEffect(() => {
    if (code.length === 6 && !busy) confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (sentTo) {
    return (
      <AuthCard>
        <Text style={styles.title}>Enter your code</Text>
        <Text style={styles.subtitle}>Sent to {sentTo}</Text>
        <TextInput
          style={styles.input}
          placeholder="6-digit code"
          placeholderTextColor={colors.textFaint}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, ""))}
          maxLength={6}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        {busy && <ActivityIndicator color={colors.primary} />}
        <Pressable style={styles.link} onPress={() => setSentTo(null)}>
          <Text style={styles.linkText}>Use a different number</Text>
        </Pressable>
      </AuthCard>
    );
  }

  const canSend = phone.trim().length > 0 && !busy;
  return (
    <AuthCard>
      <Text style={styles.title}>Add your phone number</Text>
      <Text style={styles.subtitle}>
        We text you a code to confirm it. Having both Google and your number keeps your account safe and lets you
        always get back in. If you already have a RunStride account with this number, we'll join them.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Phone number"
        placeholderTextColor={colors.textFaint}
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
        onSubmitEditing={canSend ? send : undefined}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={[styles.primary, !canSend && styles.disabled]} onPress={send} disabled={!canSend}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Send code</Text>}
      </Pressable>
    </AuthCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: "700", color: colors.heading, marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginBottom: 28 },
  input: { backgroundColor: colors.surface, color: colors.heading, borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 16 },
  error: { color: colors.dangerText, fontSize: 14, marginTop: -8, marginBottom: 16 },
  primary: { backgroundColor: colors.primary, paddingVertical: 14, borderRadius: 999, alignItems: "center" },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  link: { alignSelf: "center", padding: 14 },
  linkText: { color: colors.textMuted, fontSize: 15 },
});
