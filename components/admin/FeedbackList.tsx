import { View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text } from "../ui/Text";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ApiError, apiRequest, getFeedback, type FeedbackItem } from "../../lib/api";
import { formatWhen } from "../../lib/format";
import { Dropdown } from "../ui/Dropdown";
import { useChat } from "../ChatProvider";
import { colors, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const LISTS = [
  { value: "open", label: "To read" },
  { value: "done", label: "Done" },
] as const;

// What users sent from "Send feedback", newest first
export function FeedbackList() {
  const { token } = useChat();
  const [list, setList] = useState<string[]>(["open"]);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await getFeedback(token, list[0] as "open" | "done");
      setItems(page.items);
      setTotal(page.total);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, list]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const more = async () => {
    if (!token || !items) return;
    const page = await getFeedback(token, list[0] as "open" | "done", items.length);
    setItems([...items, ...page.items]);
  };

  const done = async (item: FeedbackItem) => {
    if (!token) return;
    try {
      await apiRequest<void>(`/admin/feedback/${item.id}/done`, { method: "POST", token });
      setItems((current) => current?.filter((i) => i.id !== item.id) ?? null);
      setTotal((t) => t - 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  return (
    <View style={styles.wrap}>
      <Dropdown
        label="Show"
        options={LISTS}
        selected={list}
        onChange={(v) => {
          setItems(null);
          setList(v);
        }}
        style={styles.drop}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {items === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>{list[0] === "open" ? "Nothing new. 🎉" : "Nothing here yet."}</Text>
      ) : (
        items.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.meta}>
              {item.displayName ?? "Deleted account"}
              {item.phone ? ` · ${item.phone}` : ""} · {item.platform ?? "?"} · {formatWhen(item.createdAt)}
            </Text>
            <Text style={styles.body}>{item.body}</Text>
            {item.status === "open" && (
              <Pressable style={styles.doneButton} onPress={() => done(item)}>
                <Text style={styles.doneText}>Mark as done</Text>
              </Pressable>
            )}
          </View>
        ))
      )}
      {items !== null && items.length < total && (
        <Pressable style={styles.more} onPress={more}>
          <Text style={styles.moreText}>
            Load more ({items.length} of {total})
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, maxWidth: 900, width: "100%", alignSelf: "center", paddingBottom: 40 },
  drop: { flexGrow: 0, alignSelf: "flex-start", minWidth: 180, marginBottom: 12 },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 10 },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 24 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  meta: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  body: { color: colors.heading, fontSize: 15, lineHeight: 21 },
  doneButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: 10,
  },
  doneText: { color: colors.heading, fontSize: 13, fontWeight: "700" },
  more: { alignSelf: "center", padding: 14 },
  moreText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
});
