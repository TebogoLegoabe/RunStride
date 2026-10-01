import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Image, Modal } from "react-native";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, deleteAccount, getMe, getMyProfile, mediaUrl } from "../../../lib/api";
import { clearToken } from "../../../lib/session";
import type { Me, MyProfile } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { colors } from "../../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

type Confirm = "sign-out" | "delete" | null;

export default function ProfileTab() {
  const router = useRouter();
  const { token } = useChat();
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      <Text style={styles.section}>Your profile</Text>
      <View style={styles.group}>
        {row("images-outline", "Photos, name and bio", "/profile-setup")}
        {row("walk-outline", "Running preferences", "/running-preferences")}
        {row("heart-outline", "Who you'd like to meet", "/dating-preferences")}
      </View>

      <Text style={styles.section}>Account</Text>
      <View style={styles.group}>
        <Pressable style={styles.row} onPress={() => setConfirm("sign-out")}>
          <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
          <Text style={styles.rowText}>Sign out</Text>
        </Pressable>
        <Pressable style={styles.row} onPress={() => setConfirm("delete")}>
          <Ionicons name="trash-outline" size={20} color={colors.dangerText} />
          <Text style={[styles.rowText, styles.dangerText]}>Delete account</Text>
        </Pressable>
      </View>
      <Text style={styles.footnote}>Signed in as {me.phone}</Text>

      <Modal visible={confirm !== null} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            {confirm === "sign-out" ? (
              <>
                <Text style={styles.modalTitle}>Sign out?</Text>
                <Text style={styles.modalBody}>
                  Your matches and chats will be here when you sign back in with {me.phone}.
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
  content: { padding: 16, paddingTop: 56, paddingBottom: 48, maxWidth: 560, width: "100%", alignSelf: "center" },
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
