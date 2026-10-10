import { View, Pressable, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { Text, TextInput } from "../ui/Text";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  ApiError,
  closeListing,
  createListing,
  getEntryWants,
  getListings,
  markSwapsSeen,
  sendChatRequest,
  setEntryWants,
} from "../../lib/api";
import { useMembership } from "../MembershipProvider";
import { openPlus } from "../../lib/upsell";
import { formatRaceDates } from "../../lib/format";
import type { Listing, RaceDetail } from "../../lib/types";
import { useChat } from "../ChatProvider";
import { ChoiceChips } from "../ChoiceChips";
import { colors, fonts, radius } from "../../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const KINDS = [
  { value: "offering", label: "I have an entry" },
  { value: "looking", label: "I need an entry" },
] as const;

type Props = { race: RaceDetail };

export function RaceSwaps({ race }: Props) {
  const router = useRouter();
  const { token, subscribe, refreshRaceAlerts } = useChat();
  const { hasRaceAccess } = useMembership();
  const alerts = hasRaceAccess(race.id);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [kind, setKind] = useState<("offering" | "looking")[]>(["offering"]);
  const [eventId, setEventId] = useState<string[]>(race.events[0] ? [race.events[0].id] : []);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = race.swapWindow === "open";
  // Entry alerts can be set before the window opens, so you're first to know
  const canWant = open || race.swapWindow === "upcoming";
  const [wanted, setWanted] = useState<string[] | null>(null);

  useEffect(() => {
    if (!token || !canWant) return;
    getEntryWants(token, race.id)
      .then((w) => setWanted(w.raceEventIds))
      .catch(() => setWanted([]));
  }, [token, race.id, canWant]);

  const changeWanted = async (next: string[]) => {
    if (!token) return;
    const before = wanted;
    setWanted(next); // straight away; put back if saving fails
    try {
      setWanted((await setEntryWants(token, race.id, next)).raceEventIds);
    } catch (e) {
      setWanted(before);
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  };

  const load = useCallback(async () => {
    if (!token || !open) return;
    try {
      setListings(await getListings(token, race.id));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, race.id, open]);

  // Looking at the board clears its swap alerts
  const seen = useCallback(() => {
    if (!token || !open) return;
    markSwapsSeen(token, race.id)
      .then(refreshRaceAlerts)
      .catch(() => {});
  }, [token, race.id, open, refreshRaceAlerts]);

  useEffect(() => {
    load().then(seen);
  }, [load, seen]);

  // A post answering yours while you're here
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "swap_match" && e.raceId === race.id) load().then(seen);
      }),
    [subscribe, race.id, load, seen]
  );

  const myOpenPosts = listings?.filter((l) => l.mine) ?? [];

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
    open: `The official transfer window is open until ${windowDates?.split(" – ").pop() ?? "it closes"}.`,
    upcoming: `The official transfer window opens ${race.substitutionOpensOn ? formatRaceDates(race.substitutionOpensOn, race.substitutionOpensOn) : "soon"}.`,
    closed: "The official transfer window has closed, so entries can't change hands any more.",
    none: "This race has no official entry transfer, so entries can't be swapped. Check with the organisers.",
  }[race.swapWindow];

  const steps: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: "search", text: "Find someone here: post your entry, or set an alert for the one you want." },
    { icon: "chatbubbles", text: "Agree the details in a private chat." },
    { icon: "document-text", text: "Do the transfer on the organiser's official site. That's what makes it valid." },
  ];

  return (
    <View>
      <View style={styles.howBox}>
        <Text style={styles.howTitle}>How entry swaps work</Text>
        {steps.map((step, i) => (
          <View key={step.icon} style={styles.step}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step.text}</Text>
          </View>
        ))}
        {race.substitutionUrl && (
          <Pressable onPress={() => Linking.openURL(race.substitutionUrl!)} style={styles.officialLink}>
            <Ionicons name="open-outline" size={15} color={colors.primary} />
            <Text style={styles.link}>Organiser's official transfer page</Text>
          </Pressable>
        )}
        <Text style={styles.payNote}>
          RunStride doesn't handle payments. Only pay once the organiser confirms the transfer, and report anyone who
          pressures you.
        </Text>
      </View>

      <View style={[styles.statusRow, open ? styles.statusOpen : styles.statusClosed]}>
        <Ionicons
          name={open ? "lock-open" : race.swapWindow === "upcoming" ? "time-outline" : "lock-closed"}
          size={16}
          color={open ? colors.primary : colors.textMuted}
        />
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      {canWant && race.events.length > 0 && (
        <View style={styles.wantBox}>
          <View style={styles.wantHeader}>
            <Ionicons name={alerts ? "notifications" : "notifications-outline"} size={18} color={colors.pink} />
            <Text style={styles.wantTitle}>Need an entry? Get alerted</Text>
          </View>
          <Text style={styles.wantBody}>Pick the distances you want. Sellers can see that someone needs one.</Text>
          {wanted === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <ChoiceChips
              options={race.events.map((e) => ({ value: e.id, label: e.label }))}
              selected={wanted}
              onChange={changeWanted}
            />
          )}
          {wanted && wanted.length > 0 &&
            (alerts ? (
              <Text style={styles.alertOnText}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} /> We'll alert you the moment one is
                offered{open ? "" : " once the window opens"}.
              </Text>
            ) : (
              <Pressable
                onPress={() =>
                  openPlus(router, {
                    reason: "Get alerted the moment the entry you need is offered.",
                    raceId: race.id,
                    raceName: race.name,
                  })
                }
              >
                <Text style={styles.alertOffText}>
                  <Ionicons name="lock-closed" size={13} color={colors.primary} /> Instant alerts come with Plus or a
                  race pass. <Text style={styles.alertLink}>Turn them on</Text>
                </Text>
              </Pressable>
            ))}
        </View>
      )}

      {open && (
        <>
          {myOpenPosts.length > 0 && !alerts && (
            <Pressable
              style={styles.alertOff}
              onPress={() =>
                openPlus(router, {
                  reason: "Get an alert the moment someone answers your swap post.",
                  raceId: race.id,
                  raceName: race.name,
                })
              }
            >
              <Ionicons name="notifications-off-outline" size={16} color={colors.primary} />
              <Text style={styles.alertText}>
                Don't miss a reply. <Text style={styles.alertLink}>Turn on swap alerts</Text> with Plus or a race pass.
              </Text>
            </Pressable>
          )}

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
                {l.interestedCount > 0 && (
                  <Text style={styles.interest}>
                    {l.kind === "offering"
                      ? `${l.interestedCount} ${l.interestedCount === 1 ? "person needs" : "people need"} this entry`
                      : `${l.interestedCount} ${l.interestedCount === 1 ? "entry" : "entries"} on offer for this distance`}
                  </Text>
                )}
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
  howBox: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 10, gap: 8 },
  howTitle: { color: colors.heading, fontSize: 15, fontFamily: fonts.bold },
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumberText: { color: colors.onPrimary, fontSize: 12, fontFamily: fonts.bold },
  stepText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
  officialLink: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  link: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  payNote: { color: colors.warningSoft, fontSize: 12, lineHeight: 17 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
  },
  statusOpen: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  statusClosed: { borderColor: colors.border, backgroundColor: colors.surface },
  statusText: { color: colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
  wantBox: {
    borderWidth: 1,
    borderColor: colors.pink,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 14,
    backgroundColor: colors.pinkTint,
  },
  wantHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  wantTitle: { color: colors.heading, fontSize: 15, fontFamily: fonts.bold },
  wantBody: { color: colors.textMuted, fontSize: 13, marginTop: 4, marginBottom: 10 },
  alertOnText: { color: colors.text, fontSize: 13, marginTop: 2 },
  alertOffText: { color: colors.text, fontSize: 13, marginTop: 2, lineHeight: 18 },
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
  interest: { color: colors.pink, fontSize: 12, fontWeight: "700", marginTop: 6 },
  alertOff: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: colors.primaryTint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  alertText: { color: colors.text, fontSize: 13, flex: 1, lineHeight: 18 },
  alertLink: { color: colors.primary, fontWeight: "700" },
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
