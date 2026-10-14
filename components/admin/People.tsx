import { View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Text, TextInput } from "../ui/Text";
import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, getAdminUsers, giveUserPlus, setUserStatus, takeUserPlus } from "../../lib/api";
import type { AdminUserRow } from "../../lib/types";
import { Dropdown } from "../ui/Dropdown";
import { useChat } from "../ChatProvider";
import { colors, fonts, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "active", label: "Recently active" },
] as const;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// Find anyone, see how they're doing, and act: suspend, ban, give or take Plus
export function People() {
  const { token } = useChat();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string[]>(["newest"]);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Search as they type, after a short pause
  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const page = await getAdminUsers(token, { q: search, sort: sort[0] as "newest" | "active" });
      setUsers(page.items);
      setTotal(page.total);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, search, sort]);

  useEffect(() => {
    setUsers(null);
    load();
  }, [load]);

  const loadMore = async () => {
    if (!token || !users) return;
    try {
      const page = await getAdminUsers(token, { q: search, sort: sort[0] as "newest" | "active", offset: users.length });
      setUsers([...users, ...page.items]);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const act = async (user: AdminUserRow, run: () => Promise<AdminUserRow>) => {
    setError(null);
    try {
      const updated = await run();
      setUsers((current) => current?.map((u) => (u.id === updated.id ? updated : u)) ?? null);
      setConfirmBan(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.search}
          placeholder="Search name, email or phone"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.sortRow}>
        <Dropdown label="Order" options={SORTS} selected={sort} onChange={setSort} />
        <Text style={styles.count}>{users ? `${total.toLocaleString()} ${total === 1 ? "person" : "people"}` : ""}</Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {users === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : users.length === 0 ? (
        <Text style={styles.empty}>No one matches.</Text>
      ) : (
        users.map((u) => {
          const open = openId === u.id;
          const flagged = u.accountStatus !== "active";
          return (
            <View key={u.id} style={styles.card}>
              <Pressable onPress={() => setOpenId(open ? null : u.id)} style={styles.head} accessibilityRole="button">
                <View style={styles.headText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {u.displayName ?? "No profile yet"}
                    {u.isAdmin ? "  · admin" : ""}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {u.phone ?? "no phone"}
                    {u.email ? ` · ${u.email}` : ""}
                  </Text>
                  <Text style={styles.meta}>Last seen {ago(u.lastSeenAt)}</Text>
                </View>
                <View style={styles.badges}>
                  {flagged && <Text style={[styles.badge, styles.badgeBad]}>{u.accountStatus}</Text>}
                  {u.plusActive && <Text style={[styles.badge, styles.badgeOn]}>Plus{u.plusSource === "beta" ? " (beta)" : ""}</Text>}
                  {u.verificationStatus === "verified" && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                </View>
              </Pressable>
              {open && (
                <View style={styles.actions}>
                  <Text style={styles.meta}>
                    Joined {new Date(u.createdAt).toLocaleDateString()} · {u.profileComplete ? "profile done" : "profile incomplete"} ·
                    {u.hasGoogle ? " Google linked" : " no Google"}
                  </Text>
                  <View style={styles.buttons}>
                    {u.plusActive ? (
                      <Action label="Remove Plus" onPress={() => act(u, () => takeUserPlus(token!, u.id))} />
                    ) : (
                      <Action label="Give Plus 30 days" onPress={() => act(u, () => giveUserPlus(token!, u.id, 30))} />
                    )}
                    {!u.isAdmin && u.accountStatus === "active" && (
                      <Action label="Suspend 7 days" onPress={() => act(u, () => setUserStatus(token!, u.id, "suspend", 7))} />
                    )}
                    {flagged && <Action label="Reinstate" onPress={() => act(u, () => setUserStatus(token!, u.id, "reinstate"))} />}
                    {!u.isAdmin && u.accountStatus !== "banned" &&
                      (confirmBan === u.id ? (
                        <Action danger label="Tap again to ban" onPress={() => act(u, () => setUserStatus(token!, u.id, "ban"))} />
                      ) : (
                        <Action danger label="Ban" onPress={() => setConfirmBan(u.id)} />
                      ))}
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}
      {users !== null && users.length < total && (
        <Pressable style={styles.more} onPress={loadMore}>
          <Text style={styles.moreText}>
            Load more ({users.length} of {total})
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Action({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={[styles.action, danger && styles.actionDanger]} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, maxWidth: 900, width: "100%", alignSelf: "center", paddingBottom: 40 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  search: { flex: 1, color: colors.heading, fontSize: 15, paddingVertical: 12 },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  count: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 10 },
  empty: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginTop: 24 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: 8, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  headText: { flex: 1 },
  name: { color: colors.heading, fontSize: 16, fontFamily: fonts.bold },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badges: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: { fontSize: 11, fontFamily: fonts.bold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: "hidden" },
  badgeOn: { backgroundColor: colors.primaryTint, color: colors.primary },
  badgeBad: { backgroundColor: colors.warningTint, color: colors.warningText },
  actions: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  actionDanger: { borderColor: colors.dangerText },
  actionText: { color: colors.heading, fontSize: 13, fontFamily: fonts.bold },
  actionTextDanger: { color: colors.dangerText },
  more: { alignSelf: "center", padding: 14 },
  moreText: { color: colors.primary, fontSize: 14, fontFamily: fonts.bold },
});
