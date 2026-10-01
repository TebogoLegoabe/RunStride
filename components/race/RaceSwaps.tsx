import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ApiError, closeListing, createListing, getListings, sendChatRequest } from "../../lib/api";
import { formatRaceDates } from "../../lib/format";
import type { Listing, RaceDetail } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { ChoiceChips } from "../ChoiceChips";
import { colors } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const KINDS = [
  { value: "offering", label: "I have an entry" },
  { value: "looking", label: "I need an entry" },
] as const;

type Props = { race: RaceDetail };

export function RaceSwaps({ race }: Props) {
  const router = useRouter();
  const { token } = useChat();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [kind, setKind] = useState<("offering" | "looking")[]>(["offering"]);
  const [eventId, setEventId] = useState<string[]>(race.events[0] ? [race.events[0].id] : []);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = race.swapWindow === "open";

  const load = useCallback(async () => {
    if (!token || !open) return;
    try {
      setListings(await getListings(token, race.id));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, race.id, open]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const post = () =>
    act(async () => {
      if (!eventId[0]) return;
      await createListing(token!, race.id, {
        kind: kind[0],
        raceEventId: eventId[0],
        priceRands: kind[0] === "offering" && price.trim() ? Number(price) : undefined,
        note: note.trim() || undefined,
      });
      setPrice("");
      setNote("");
      await load();
    });

  const closePost = (listing: Listing) =>
    act(async () => {
      await closeListing(token!, listing.id);
      await load();
    });

  const message = (listing: Listing) =>
    act(async () => {
      const request = await sendChatRequest(token!, { toUserId: listing.user.id, listingId: listing.id });
      if (request.status === "accepted" && request.matchId) {
        router.push({
          pathname: "/chat/[matchId]",
          params: { matchId: request.matchId, userId: listing.user.id, name: listing.user.displayName, photo: listing.user.photo ?? "" },
        });
      } else {
        setNotice(`Request sent to ${listing.user.displayName}. You can chat once they accept.`);
      }
    });

  const windowDates =
    race.substitutionOpensOn && race.substitutionClosesOn
      ? formatRaceDates(race.substitutionOpensOn, race.substitutionClosesOn)
      : null;

  const status = {
    open: `The official entry transfer window is open (${windowDates}).`,
    upcoming: `Swaps open during the official entry transfer window: ${windowDates}.`,
    closed: `The official entry transfer window (${windowDates}) has closed, so entries can't be swapped any more.`,
    none: "This race doesn't have an official entry transfer window, so entries can't be swapped here. Check with the organisers.",
  }[race.swapWindow];

  return (
    <View>
      <View style={[styles.statusBox, open ? styles.statusOpen : styles.statusClosed]}>
        <Text style={styles.statusText}>{status}</Text>
        {race.substitutionUrl && (
          <Pressable onPress={() => Linking.openURL(race.substitutionUrl!)}>
            <Text style={styles.link}>Official transfer process →</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.rules}>
        <Text style={styles.rulesText}>
          Transfers must go through the organiser's official process so the right name and medical details are on
          the bib. RunStride doesn't handle payments: never pay before the organiser confirms the transfer, and
          report anyone who pressures you.
        </Text>
      </View>

      {open && (
        <>
          {error && <Text style={styles.error}>{error}</Text>}
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Text style={styles.section}>Post on the board</Text>
          <ChoiceChips options={KINDS} selected={kind} onChange={setKind} single />
          <ChoiceChips
            options={race.events.map((e) => ({ value: e.id, label: e.label }))}
            selected={eventId}
            onChange={setEventId}
            single
          />
          {kind[0] === "offering" && (
            <TextInput
              style={styles.input}
              placeholder="Price in rand (what you paid or less, optional)"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              value={price}
              onChangeText={(t) => setPrice(t.replace(/\D/g, ""))}
              maxLength={6}
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Note (optional), e.g. Injured, can't run"
            placeholderTextColor={colors.textFaint}
            value={note}
            onChangeText={setNote}
            maxLength={300}
          />
          <Pressable style={styles.primary} onPress={post} disabled={busy || !eventId[0]}>
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Post</Text>}
          </Pressable>

          <Text style={styles.section}>On the board</Text>
          {listings === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : listings.length === 0 ? (
            <Text style={styles.empty}>No posts yet.</Text>
          ) : (
            listings.map((l) => (
              <View key={l.id} style={styles.card}>
                <Text style={[styles.kind, l.kind === "offering" ? styles.offering : styles.looking]}>
                  {l.kind === "offering" ? "Has an entry" : "Needs an entry"} · {l.eventLabel}
                </Text>
                <Text style={styles.who}>
                  {l.mine ? "You" : l.user.displayName}
                  {l.priceRands !== null ? ` · R${l.priceRands}` : ""}
                </Text>
                {l.note && <Text style={styles.note}>{l.note}</Text>}
                {l.mine ? (
                  <Pressable onPress={() => closePost(l)}>
                    <Text style={styles.closeText}>Close post</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.outline} onPress={() => message(l)} disabled={busy}>
                    <Text style={styles.outlineText}>Message</Text>
                  </Pressable>
                )}
              </View>
            ))
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  statusBox: { borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1 },
  statusOpen: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  statusClosed: { borderColor: colors.border, backgroundColor: colors.surface },
  statusText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  link: { color: colors.primary, fontSize: 14, fontWeight: "700", marginTop: 6 },
  rules: { backgroundColor: colors.warningTint, borderRadius: 12, padding: 12, marginBottom: 14 },
  rulesText: { color: colors.warningSoft, fontSize: 13, lineHeight: 19 },
  section: { color: colors.heading, fontSize: 15, fontWeight: "700", marginTop: 8, marginBottom: 10 },
  input: { backgroundColor: colors.surface, color: colors.heading, borderRadius: 12, padding: 12, fontSize: 15, marginBottom: 10 },
  primary: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 12, alignItems: "center", marginBottom: 8 },
  primaryText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: "center", marginVertical: 12 },
  error: { color: colors.dangerText, fontSize: 13, marginBottom: 8 },
  notice: { color: colors.primary, fontSize: 13, marginBottom: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  kind: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  offering: { color: colors.primary },
  looking: { color: colors.pink },
  who: { color: colors.heading, fontSize: 15, fontWeight: "600" },
  note: { color: colors.text, fontSize: 14, marginTop: 4 },
  outline: {
    alignSelf: "flex-start",
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 10,
  },
  outlineText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  closeText: { color: colors.textMuted, fontSize: 13, textDecorationLine: "underline", marginTop: 10 },
});
