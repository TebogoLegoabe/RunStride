import { View, Pressable, StyleSheet, ActivityIndicator, Image, ScrollView } from "react-native";
import { Text } from "../ui/Text";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiError, decideIdCheck, getIdChecks, mediaUrl } from "../../lib/api";
import { formatWhen } from "../../lib/format";
import type { IdReview } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { colors } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const REJECT_REASONS = [
  "The ID photo isn't clear",
  "The selfie isn't clear",
  "The selfie doesn't match your profile photos",
  "The ID number doesn't match the ID photo",
];

// Admins compare the ID photo and selfie with the profile photos. Files are deleted when you decide.
export function IdChecks() {
  const { token } = useChat();
  const [items, setItems] = useState<IdReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setItems(await getIdChecks(token));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const decide = async (item: IdReview, approve: boolean, reason?: string) => {
    if (!token) return;
    try {
      await decideIdCheck(token, item.id, approve, reason);
      setRejecting(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  if (items === null) return error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />;

  return (
    <View style={styles.wrap}>
      {error && <Text style={styles.error}>{error}</Text>}
      {items.length === 0 && <Text style={styles.empty}>No ID checks waiting. 🎉</Text>}
      {items.map((item) => (
        <View key={item.id} style={styles.card}>
          <Text style={styles.name}>
            {item.displayName}, {item.age}
          </Text>
          <Text style={styles.meta}>Sent {formatWhen(item.submittedAt)}</Text>
          <Text style={styles.meta}>
            Profile date of birth: {item.birthDate} ·{" "}
            <Text style={item.bornMatches ? styles.ok : styles.bad}>
              {item.bornMatches ? "matches the ID number" : "does NOT match the ID number"}
            </Text>
          </Text>
          <Text style={styles.number}>ID number: {item.idNumber ?? "-"}</Text>

          <Text style={styles.section}>ID and selfie (check the number and face match)</Text>
          <View style={styles.row}>
            {item.idPhotoUrl && <Image source={{ uri: item.idPhotoUrl }} style={styles.big} resizeMode="contain" />}
            {item.selfieUrl && <Image source={{ uri: item.selfieUrl }} style={styles.big} resizeMode="contain" />}
          </View>

          <Text style={styles.section}>Their profile photos</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {item.profilePhotos.map((url) => (
              <Image key={url} source={{ uri: mediaUrl(url) }} style={styles.profilePhoto} />
            ))}
          </ScrollView>

          {rejecting === item.id ? (
            <View style={styles.reasons}>
              <Text style={styles.section}>Why? (they will see this)</Text>
              {REJECT_REASONS.map((reason) => (
                <Pressable key={reason} style={styles.reason} onPress={() => decide(item, false, reason)}>
                  <Text style={styles.reasonText}>{reason}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setRejecting(null)}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable style={styles.outline} onPress={() => setRejecting(item.id)}>
                <Text style={styles.outlineText}>Reject</Text>
              </Pressable>
              <Pressable style={styles.primary} onPress={() => decide(item, true)}>
                <Text style={styles.primaryText}>Approve</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, maxWidth: 720, width: "100%", alignSelf: "center" },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 10 },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 12 },
  name: { color: colors.heading, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  number: { color: colors.heading, fontSize: 15, fontWeight: "700", marginTop: 6 },
  ok: { color: colors.primary, fontWeight: "700" },
  bad: { color: colors.dangerText, fontWeight: "700" },
  section: { color: colors.textFaint, fontSize: 12, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8 },
  big: { flex: 1, height: 200, borderRadius: 10, backgroundColor: colors.bg },
  profilePhoto: { width: 80, height: 100, borderRadius: 8, marginRight: 8, backgroundColor: colors.bg },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 14 },
  outline: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  outlineText: { color: colors.heading, fontSize: 15, fontWeight: "600" },
  primary: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22 },
  primaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  reasons: { marginTop: 4 },
  reason: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginBottom: 6 },
  reasonText: { color: colors.heading, fontSize: 14 },
  cancel: { color: colors.textMuted, fontSize: 14, textAlign: "center", padding: 8 },
});
