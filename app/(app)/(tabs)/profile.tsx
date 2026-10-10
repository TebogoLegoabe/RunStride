import { View, StyleSheet, Pressable, ActivityIndicator, ScrollView, Image, Modal, Switch } from "react-native";
import { Text } from "../../../components/ui/Text";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  ApiError,
  connectGoogle,
  deleteAccount,
  disconnectGoogle,
  getMe,
  getMyProfile,
  mediaUrl,
  setDatingMode,
} from "../../../lib/api";
import { unregisterPush } from "../../../lib/push";
import { GoogleButton, googleAvailable } from "../../../components/GoogleButton";
import { useMembership } from "../../../components/MembershipProvider";
import { formatRaceDates } from "../../../lib/format";
import { openPlus } from "../../../lib/upsell";
import { clearToken } from "../../../lib/session";
import type { Me, MyProfile } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { colors } from "../../../lib/theme";
import { useTopPadding } from "../../../lib/responsive";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

// "Mon 3 Nov" from an ISO timestamp
const day = (iso: string) => formatRaceDates(iso.slice(0, 10), iso.slice(0, 10));

type Confirm = "sign-out" | "delete" | null;

export default function ProfileTab() {
  const topPadding = useTopPadding();
  const router = useRouter();
  const { token } = useChat();
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { membership, update: updateMembership } = useMembership();
  const [switching, setSwitching] = useState(false);

  const linkGoogle = async (idToken: string) => {
    if (!token) return;
    setError(null);
    try {
      setMe(await connectGoogle(token, idToken));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const unlinkGoogle = async () => {
    if (!token) return;
    setError(null);
    try {
      setMe(await disconnectGoogle(token));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const setTaken = async (taken: boolean) => {
    if (!token) return;
    setSwitching(true);
    setError(null);
    try {
      updateMembership(await setDatingMode(token, taken ? "taken" : "looking"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setSwitching(false);
    }
  };

  // Reload when coming back from an edit screen
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      Promise.all([getMe(token), getMyProfile(token)])
        .then(([m, p]) => {
          setMe(m);
          setProfile(p);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : NETWORK_ERROR));
    }, [token])
  );

  const signOut = async () => {
    // This phone stops getting this account's notifications
    if (token) await unregisterPush(token);
    await clearToken();
    // Leaving the signed-in area also closes the live chat connection
    router.replace("/");
  };

  const removeAccount = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(token);
      await signOut();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
      setBusy(false);
      setConfirm(null);
    }
  };

  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, href: Href) => (
    <Pressable style={styles.row} onPress={() => router.push(href)}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.rowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );

  if (!profile || !me) {
    return (
      <View style={[styles.container, styles.centered]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const photo = profile.photos[0]?.url;
  const verified = me.verificationStatus === "verified";

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: topPadding }]}>
      <View style={styles.header}>
        {photo ? (
          <Image source={{ uri: mediaUrl(photo) }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]} />
        )}
        <Text style={styles.name}>
          {profile.displayName}, {profile.age}
        </Text>
        <Text style={[styles.badge, verified ? styles.badgeOn : styles.badgeOff]}>
          {verified ? "✓ ID verified" : "ID verification coming soon"}
        </Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {membership && (
        <>
          <Text style={styles.section}>Membership</Text>
          <View style={styles.group}>
            <Pressable style={styles.row} onPress={() => openPlus(router)}>
              <Ionicons name="flash" size={20} color={colors.primary} />
              <View style={styles.rowStack}>
                <Text style={styles.rowTitle}>RunStride Plus</Text>
                <Text style={styles.rowSub}>
                  {membership.plus.active
                    ? membership.plus.expiresAt
                      ? `Active until ${day(membership.plus.expiresAt)}`
                      : membership.plus.source === "admin"
                        ? "Active, given by RunStride"
                        : "Active"
                    : "Everyone at your races, unlimited likes and swap alerts"}
                </Text>
              </View>
              <Text style={membership.plus.active ? styles.statusOn : styles.statusCta}>
                {membership.plus.active ? "Active" : "Get Plus"}
              </Text>
            </Pressable>
            {(membership.racePasses.length > 0 || membership.racePassCredits > 0) && (
              <View style={styles.row}>
                <Ionicons name="ticket-outline" size={20} color={colors.primary} />
                <View style={styles.rowStack}>
                  <Text style={styles.rowTitle}>Race passes</Text>
                  {membership.racePasses.map((pass) => (
                    <Text key={pass.raceId} style={styles.rowSub}>
                      {pass.raceName}
                    </Text>
                  ))}
                  {membership.racePassCredits > 0 && (
                    <Text style={styles.rowSub}>
                      {membership.racePassCredits} unused: use one from any race page
                    </Text>
                  )}
                </View>
              </View>
            )}
            <View style={styles.row}>
              <Ionicons name="heart-circle-outline" size={20} color={colors.pink} />
              <View style={styles.rowStack}>
                <Text style={styles.rowTitle}>Seeing someone</Text>
                <Text style={styles.rowSub}>
                  Turns dating off: you're hidden from Discover and race runner lists. Races, chats and swaps carry
                  on.
                </Text>
              </View>
              <Switch
                value={membership.datingMode === "taken"}
                onValueChange={setTaken}
                disabled={switching}
                trackColor={{ false: colors.border, true: colors.pink }}
                thumbColor={colors.heading}
                accessibilityLabel="Seeing someone: turn dating off"
              />
            </View>
          </View>
        </>
      )}

      <Text style={styles.section}>Your profile</Text>
      <View style={styles.group}>
        {row("images-outline", "Photos, name and bio", "/profile-setup")}
        {row("walk-outline", "Running preferences", "/running-preferences")}
        {row("heart-outline", "Who you'd like to meet", "/dating-preferences")}
      </View>

      <Text style={styles.section}>Account</Text>
      <View style={styles.group}>
        {row("notifications-outline", "Notifications", "/notifications")}
        {me.hasGoogle ? (
          <View style={styles.row}>
            <Ionicons name="logo-google" size={20} color={colors.primary} />
            <View style={styles.rowStack}>
              <Text style={styles.rowTitle}>Google connected</Text>
              {me.email && <Text style={styles.rowSub}>{me.email}</Text>}
            </View>
            {me.phone && (
              <Pressable onPress={unlinkGoogle} hitSlop={8}>
                <Text style={styles.statusCta}>Disconnect</Text>
              </Pressable>
            )}
          </View>
        ) : (
          googleAvailable() && (
            <View style={[styles.row, styles.googleRow]}>
              <Text style={styles.rowSub}>Connect Google to sign in with it as well as your number.</Text>
              <GoogleButton title="Connect Google" onIdToken={linkGoogle} onError={setError} />
            </View>
          )
        )}
        <Pressable style={styles.row} onPress={() => setConfirm("sign-out")}>
          <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
          <Text style={styles.rowText}>Sign out</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => setConfirm("delete")}>
          <Ionicons name="trash-outline" size={20} color={colors.dangerText} />
          <Text style={[styles.rowText, styles.dangerText]}>Delete account</Text>
        </Pressable>
      </View>
      <Text style={styles.footnote}>Signed in as {me.phone ?? me.email ?? "a Google account"}</Text>

      <Modal visible={confirm !== null} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            {confirm === "sign-out" ? (
              <>
                <Text style={styles.modalTitle}>Sign out?</Text>
                <Text style={styles.modalBody}>
                  Your matches and chats will be here when you sign back in with{" "}
                  {me.phone ?? "Google"}.
                </Text>
                <Pressable style={styles.primaryButton} onPress={signOut}>
                  <Text style={styles.primaryText}>Sign out</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Delete your account?</Text>
                <Text style={styles.modalBody}>
                  This permanently deletes your profile, photos, matches and chats. It can't be undone.
                  If you just want a break, sign out instead.
                </Text>
                <Pressable style={styles.dangerButton} onPress={removeAccount} disabled={busy}>
                  {busy ? (
                    <ActivityIndicator color={colors.heading} />
                  ) : (
                    <Text style={styles.dangerButtonText}>Delete my account</Text>
                  )}
                </Pressable>
              </>
            )}
            <Pressable style={styles.cancelButton} onPress={() => setConfirm(null)} disabled={busy}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingBottom: 48, maxWidth: 560, width: "100%", alignSelf: "center" },
  header: { alignItems: "center", marginBottom: 12 },
  photo: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.surface, marginBottom: 12 },
  photoEmpty: { borderWidth: 1, borderColor: colors.borderStrong },
  name: { color: colors.heading, fontSize: 24, fontWeight: "700" },
  badge: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  badgeOn: { backgroundColor: colors.primary, color: colors.onPrimary },
  badgeOff: { backgroundColor: colors.warningTint, color: colors.warningText },
  section: { color: colors.textMuted, fontSize: 13, fontWeight: "700", marginTop: 24, marginBottom: 8, marginLeft: 4 },
  group: { backgroundColor: colors.surface, borderRadius: 14, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1, color: colors.textBright, fontSize: 16 },
  rowStack: { flex: 1, gap: 2 },
  googleRow: { flexDirection: "column", alignItems: "stretch", gap: 10 },
  rowTitle: { color: colors.textBright, fontSize: 16 },
  rowSub: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  statusOn: { color: colors.success, fontSize: 13, fontWeight: "700" },
  statusCta: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  dangerText: { color: colors.dangerText },
  footnote: { color: colors.textFaint, fontSize: 12, textAlign: "center", marginTop: 20 },
  error: { color: colors.dangerText, fontSize: 14, marginTop: 12, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: "center", justifyContent: "center", padding: 24 },
  modal: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, width: "100%", maxWidth: 400 },
  modalTitle: { color: colors.heading, fontSize: 20, fontWeight: "700", marginBottom: 10 },
  modalBody: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  primaryButton: { backgroundColor: colors.primary, paddingVertical: 13, borderRadius: 999, alignItems: "center" },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
  dangerButton: { backgroundColor: colors.danger, paddingVertical: 13, borderRadius: 999, alignItems: "center" },
  dangerButtonText: { color: colors.heading, fontSize: 16, fontWeight: "700" },
  cancelButton: { paddingVertical: 12, alignItems: "center", marginTop: 6 },
  cancelText: { color: colors.textMuted, fontSize: 15 },
});
