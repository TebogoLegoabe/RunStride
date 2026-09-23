import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
  Share,
  Linking,
  Platform,
} from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import {
  ApiError,
  addTrustedContact,
  checkInRun,
  getRunSafety,
  raiseAlert,
  removeTrustedContact,
  sendShareLocation,
  startSharing,
  stopSharing,
} from "../../../lib/api";
import { formatClock, formatRunTime } from "../../../lib/format";
import type { RunSafety, RunShare } from "../../../lib/types";
import { useChat } from "../../../components/ChatProvider";
import { SafetySheet } from "../../../components/SafetySheet";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";
const MAX_CONTACTS = 3;
// How often to send the position while sharing
const LOCATION_INTERVAL_MS = 15_000;
const LOCATION_MIN_METRES = 20;

const isLive = (share: RunShare | null) => share?.status === "active" || share?.status === "alert";

export default function RunSafetyScreen() {
  const router = useRouter();
  const { runDateId } = useLocalSearchParams<{ runDateId: string }>();
  const { token } = useChat();
  const [data, setData] = useState<RunSafety | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [confirmAlert, setConfirmAlert] = useState(false);
  const [linkFallback, setLinkFallback] = useState<string | null>(null);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);

  const setShare = (share: RunShare) => setData((d) => (d ? { ...d, share } : d));

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await getRunSafety(token, runDateId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    }
  }, [token, runDateId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  // While sharing is live and this screen is open, send the position as it changes.
  // (Expo Go only tracks in the foreground; background tracking needs a development build.)
  const shareId = isLive(data?.share ?? null) ? data!.share!.id : null;
  useEffect(() => {
    if (!token || !shareId) return;
    let cancelled = false;
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationProblem("Allow location access so your trusted contacts can see where you are.");
        return;
      }
      setLocationProblem(null);
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_INTERVAL_MS,
          distanceInterval: LOCATION_MIN_METRES,
        },
        ({ coords }) => {
          sendShareLocation(token, shareId, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracyM: coords.accuracy ?? undefined,
          })
            .then(() =>
              setData((d) => (d?.share ? { ...d, share: { ...d.share, locationAt: new Date().toISOString() } } : d))
            )
            .catch((e) => {
              // Sharing ended elsewhere (expired, or stopped on another device)
              if (e instanceof ApiError && e.status === 409) load();
            });
        }
      );
      if (cancelled) sub.remove();
      else watcher.current = sub;
    })();
    return () => {
      cancelled = true;
      watcher.current?.remove();
      watcher.current = null;
    };
  }, [token, shareId, load]);

  if (!data) {
    return (
      <View style={[styles.container, styles.centered]}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color="#4ecdc4" />}
      </View>
    );
  }

  const { run, share, trustedContacts, otherName } = data;
  const now = Date.now();
  const opensAt = new Date(data.shareOpensAt).getTime();
  const closesAt = new Date(data.shareClosesAt).getTime();
  const started = now >= new Date(run.startsAt).getTime();
  const happening = run.status === "accepted";
  const live = isLive(share);

  const sendLink = async (url: string) => {
    const message =
      `I'm meeting ${otherName} for a run at ${run.place}, ${formatRunTime(run.startsAt)}. ` +
      `You can follow my live location here: ${url}`;
    try {
      await Share.share({ message });
    } catch {
      setLinkFallback(url); // e.g. a desktop browser with no share menu
    }
  };

  const addContact = () =>
    act(async () => {
      if (!contactName.trim() || !contactPhone.trim()) {
        setError("Enter their name and phone number.");
        return;
      }
      const contact = await addTrustedContact(token!, { name: contactName.trim(), phone: contactPhone.trim() });
      setData((d) => (d ? { ...d, trustedContacts: [...d.trustedContacts, contact] } : d));
      setContactName("");
      setContactPhone("");
    });

  const removeContact = (id: string) =>
    act(async () => {
      await removeTrustedContact(token!, id);
      setData((d) => (d ? { ...d, trustedContacts: d.trustedContacts.filter((c) => c.id !== id) } : d));
    });

  const begin = () =>
    act(async () => {
      const created = await startSharing(token!, run.id);
      setShare(created);
      await sendLink(created.url);
    });

  const panic = () =>
    act(async () => {
      setShare(await raiseAlert(token!, share!.id));
      setConfirmAlert(false);
    });

  const safe = () =>
    act(async () => {
      setShare(await stopSharing(token!, share!.id));
    });

  const checkIn = (outcome: "ok" | "problem") =>
    act(async () => {
      await checkInRun(token!, run.id, outcome);
      setData((d) => (d ? { ...d, checkIn: outcome } : d));
      if (outcome === "problem") setReportOpen(true);
    });

  const call = (number: string) => Linking.openURL(`tel:${number}`);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color="#e2e8f0" />
        <Text style={styles.backText}>Chat</Text>
      </Pressable>

      <Text style={styles.title}>Run with {otherName}</Text>
      <Text style={styles.subtitle}>
        {formatRunTime(run.startsAt)} · {run.place}
      </Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* --- Live sharing and the panic button --- */}
      <Text style={styles.section}>Share your run</Text>
      <View style={[styles.box, share?.status === "alert" && styles.alertBox]}>
        {!happening ? (
          <Text style={styles.body}>This run isn't happening, so there's nothing to share.</Text>
        ) : live ? (
          <>
            {share!.status === "alert" ? (
              <Text style={styles.alertText}>
                Alert sent. Your trusted contacts have been texted a link to your location. If you're in
                danger, call for help now.
              </Text>
            ) : (
              <Text style={styles.body}>
                <Text style={styles.liveDot}>● </Text>
                Sharing live
                {share!.locationAt ? ` · updated ${formatClock(share!.locationAt)}` : " · waiting for your location"}.
                Keep RunStride open during the run so your position stays up to date.
              </Text>
            )}
            {locationProblem && <Text style={styles.error}>{locationProblem}</Text>}

            <Pressable style={styles.outlineButton} onPress={() => sendLink(share!.url)} disabled={busy}>
              <Text style={styles.outlineText}>Send the link again</Text>
            </Pressable>
            {share!.status !== "alert" && (
              <Pressable style={styles.panicButton} onPress={() => setConfirmAlert(true)} disabled={busy}>
                <Ionicons name="alert-circle" size={22} color="#ffffff" />
                <Text style={styles.panicText}>I need help</Text>
              </Pressable>
            )}
            <View style={styles.callRow}>
              <Pressable style={styles.callButton} onPress={() => call("10111")}>
                <Text style={styles.callText}>Call 10111</Text>
              </Pressable>
              <Pressable style={styles.callButton} onPress={() => call("112")}>
                <Text style={styles.callText}>Call 112</Text>
              </Pressable>
            </View>
            <Pressable style={styles.safeButton} onPress={safe} disabled={busy}>
              <Text style={styles.safeText}>I'm safe, stop sharing</Text>
            </Pressable>
          </>
        ) : now < opensAt ? (
          <Text style={styles.body}>
            On the day, you can share your live location with a trusted contact. Sharing opens at{" "}
            {formatClock(data.shareOpensAt)} on {formatRunTime(data.shareOpensAt).split(",")[0]}, 2 hours
            before the run.
          </Text>
        ) : now < closesAt ? (
          <>
            <Text style={styles.body}>
              {share
                ? "You've stopped sharing. Start again if you'd like someone to follow along."
                : `Let someone you trust follow your location while you meet ${otherName}. You'll pick who to send the link to, e.g. on WhatsApp. It stops working after the run.`}
            </Text>
            <Pressable style={styles.primaryButton} onPress={begin} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#0f172a" />
              ) : (
                <Text style={styles.primaryText}>Start sharing my location</Text>
              )}
            </Pressable>
          </>
        ) : (
          <Text style={styles.body}>This run is over, so sharing has closed.</Text>
        )}
        {linkFallback && (
          <View style={styles.fallback}>
            <Text style={styles.label}>Copy this link and send it to someone you trust:</Text>
            <Text selectable style={styles.link}>
              {linkFallback}
            </Text>
          </View>
        )}
      </View>

      {/* --- Check-in after the run --- */}
      {happening && started && (
        <>
          <Text style={styles.section}>How did it go?</Text>
          <View style={styles.box}>
            {data.checkIn === "ok" ? (
              <Text style={styles.body}>Thanks for checking in! 🙌</Text>
            ) : data.checkIn === "problem" ? (
              <Text style={styles.body}>
                {thanks ?? "Sorry it didn't go well. If you haven't already, please report what happened."}
              </Text>
            ) : (
              <>
                <Text style={styles.body}>A quick check-in helps us keep RunStride safe. Only you see your answer.</Text>
                <View style={styles.callRow}>
                  <Pressable style={styles.okButton} onPress={() => checkIn("ok")} disabled={busy}>
                    <Text style={styles.okText}>It went well</Text>
                  </Pressable>
                  <Pressable style={styles.problemButton} onPress={() => checkIn("problem")} disabled={busy}>
                    <Text style={styles.problemText}>Report a problem</Text>
                  </Pressable>
                </View>
              </>
            )}
            {data.checkIn === "problem" && !thanks && (
              <Pressable style={styles.outlineButton} onPress={() => setReportOpen(true)}>
                <Text style={styles.outlineText}>Report {otherName}</Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      {/* --- Trusted contacts --- */}
      <Text style={styles.section}>Trusted contacts</Text>
      <View style={styles.box}>
        <Text style={styles.body}>
          If you press "I need help", they get a text with a link to your location.
        </Text>
        {trustedContacts.map((c) => (
          <View key={c.id} style={styles.contactRow}>
            <View style={styles.contactText}>
              <Text style={styles.contactName}>{c.name}</Text>
              <Text style={styles.contactPhone}>{c.phone}</Text>
            </View>
            <Pressable onPress={() => removeContact(c.id)} disabled={busy} accessibilityLabel={`Remove ${c.name}`}>
              <Ionicons name="close-circle" size={22} color="#64748b" />
            </Pressable>
          </View>
        ))}
        {trustedContacts.length === 0 && (
          <Text style={styles.warning}>You haven't added anyone yet. We recommend adding at least one person.</Text>
        )}
        {trustedContacts.length < MAX_CONTACTS && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Name, e.g. Mom"
              placeholderTextColor="#64748b"
              value={contactName}
              onChangeText={setContactName}
              maxLength={60}
            />
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor="#64748b"
              keyboardType="phone-pad"
              value={contactPhone}
              onChangeText={setContactPhone}
              maxLength={32}
            />
            <Pressable style={styles.outlineButton} onPress={addContact} disabled={busy}>
              <Text style={styles.outlineText}>Add trusted contact</Text>
            </Pressable>
          </>
        )}
      </View>

      {Platform.OS !== "web" && (
        <Text style={styles.note}>
          Tip: for now your location only updates while RunStride is open. Background sharing is coming.
        </Text>
      )}

      <Modal visible={confirmAlert} transparent animationType="fade" onRequestClose={() => setConfirmAlert(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Alert your trusted contacts?</Text>
            <Text style={styles.body}>
              {trustedContacts.length
                ? `We'll text ${trustedContacts.map((c) => c.name).join(", ")} a link to your location, and the tracking page will show you need help.`
                : "You have no trusted contacts, so nobody will be texted. The tracking page will show you need help. If you're in danger, call 10111 or 112 now."}
            </Text>
            <Pressable style={styles.panicButton} onPress={panic} disabled={busy}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.panicText}>Send alert</Text>}
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setConfirmAlert(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <SafetySheet
        visible={reportOpen}
        token={token}
        person={{ id: data.otherUserId, name: otherName }}
        matchId={run.matchId}
        onClose={() => setReportOpen(false)}
        onDone={() => {
          setReportOpen(false);
          setThanks("Thanks for telling us. Our team will review what happened.");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: 16, paddingTop: 44, paddingBottom: 48, maxWidth: 560, width: "100%", alignSelf: "center" },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { color: "#e2e8f0", fontSize: 16 },
  title: { color: "#ffffff", fontSize: 24, fontWeight: "700" },
  subtitle: { color: "#94a3b8", fontSize: 15, marginTop: 4 },
  section: { color: "#ffffff", fontSize: 17, fontWeight: "700", marginTop: 24, marginBottom: 8 },
  box: { backgroundColor: "#1e293b", borderRadius: 14, padding: 14 },
  alertBox: { borderColor: "#ef4444", borderWidth: 2 },
  body: { color: "#cbd5e1", fontSize: 15, lineHeight: 22 },
  alertText: { color: "#fecaca", fontSize: 15, lineHeight: 22, fontWeight: "600" },
  liveDot: { color: "#4ecdc4" },
  warning: { color: "#fbbf24", fontSize: 14, marginTop: 10 },
  error: { color: "#f87171", fontSize: 14, marginTop: 10 },
  label: { color: "#94a3b8", fontSize: 13, marginBottom: 4 },
  link: { color: "#4ecdc4", fontSize: 14 },
  fallback: { marginTop: 12 },
  note: { color: "#64748b", fontSize: 12, marginTop: 20, textAlign: "center" },
  primaryButton: {
    backgroundColor: "#4ecdc4",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 14,
  },
  primaryText: { color: "#0f172a", fontSize: 16, fontWeight: "700" },
  outlineButton: {
    borderColor: "#4ecdc4",
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    marginTop: 12,
  },
  outlineText: { color: "#4ecdc4", fontSize: 15, fontWeight: "600" },
  panicButton: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#ef4444",
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  panicText: { color: "#ffffff", fontSize: 17, fontWeight: "800" },
  callRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  callButton: {
    flex: 1,
    borderColor: "#ef4444",
    borderWidth: 1,
    paddingVertical: 11,
    borderRadius: 999,
    alignItems: "center",
  },
  callText: { color: "#f87171", fontSize: 15, fontWeight: "600" },
  safeButton: { paddingVertical: 12, alignItems: "center", marginTop: 8 },
  safeText: { color: "#94a3b8", fontSize: 15, textDecorationLine: "underline" },
  okButton: { flex: 1, backgroundColor: "#4ecdc4", paddingVertical: 12, borderRadius: 999, alignItems: "center" },
  okText: { color: "#0f172a", fontSize: 15, fontWeight: "700" },
  problemButton: {
    flex: 1,
    borderColor: "#f87171",
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  problemText: { color: "#f87171", fontSize: 15, fontWeight: "600" },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomColor: "#334155",
    borderBottomWidth: 1,
  },
  contactText: { flex: 1 },
  contactName: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  contactPhone: { color: "#94a3b8", fontSize: 13 },
  input: {
    backgroundColor: "#0f172a",
    color: "#ffffff",
    borderRadius: 12,
    padding: 13,
    fontSize: 15,
    marginTop: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modal: { backgroundColor: "#1e293b", borderRadius: 20, padding: 22, width: "100%", maxWidth: 400 },
  modalTitle: { color: "#ffffff", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  cancelButton: { paddingVertical: 12, alignItems: "center", marginTop: 6 },
  cancelText: { color: "#94a3b8", fontSize: 15 },
});
