import { View, Text, TextInput, Pressable, StyleSheet, Modal, ActivityIndicator, ScrollView } from "react-native";
import { useEffect, useState } from "react";
import { ApiError, blockUser, reportUser, unmatch } from "../lib/api";
import { REPORT_REASONS, type ReportReason } from "../lib/options";
import { ChoiceChips } from "./ChoiceChips";
import { colors } from "../lib/theme";

const NETWORK_ERROR = "Couldn't reach RunStride. Check your connection.";

export type SafetyOutcome = "reported" | "blocked" | "unmatched";

type Props = {
  visible: boolean;
  token: string | null;
  person: { id: string; name: string };
  // Set in a chat: attaches the conversation to reports and offers Unmatch
  matchId?: string;
  onClose: () => void;
  // Called once the person has been reported, blocked or unmatched
  onDone: (outcome: SafetyOutcome) => void;
};

type Step = "menu" | "report" | "confirm-block" | "confirm-unmatch" | "reported";

export function SafetySheet({ visible, token, person, matchId, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>("menu");
  const [reason, setReason] = useState<ReportReason[]>([]);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start fresh each time it opens
  useEffect(() => {
    if (visible) {
      setStep("menu");
      setReason([]);
      setDetails("");
      setError(null);
    }
  }, [visible]);

  const run = async (action: () => Promise<unknown>, after: () => void) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const submitReport = () => {
    if (reason.length === 0) {
      setError("Please choose a reason.");
      return;
    }
    if (reason[0] === "other" && !details.trim()) {
      setError("Please tell us what happened.");
      return;
    }
    run(
      () =>
        reportUser(token!, {
          reportedUserId: person.id,
          matchId,
          reason: reason[0],
          details: details.trim() || undefined,
        }),
      () => setStep("reported")
    );
  };

  const button = (label: string, onPress: () => void, style: "primary" | "danger" | "plain" = "plain") => (
    <Pressable
      style={[styles.button, style === "primary" && styles.primary, style === "danger" && styles.danger]}
      onPress={onPress}
      disabled={busy}
    >
      {busy && style !== "plain" ? (
        <ActivityIndicator color={style === "danger" ? colors.heading : colors.onPrimary} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            style === "primary" && styles.primaryText,
            style === "danger" && styles.dangerText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.sheet}>
            {step === "menu" && (
              <>
                <Text style={styles.title}>{person.name}</Text>
                {button(`Report ${person.name}`, () => setStep("report"))}
                {button(`Block ${person.name}`, () => setStep("confirm-block"))}
                {matchId && button("Unmatch", () => setStep("confirm-unmatch"))}
                {button("Cancel", onClose)}
              </>
            )}

            {step === "report" && (
              <>
                <Text style={styles.title}>Report {person.name}</Text>
                <Text style={styles.body}>
                  Reports are confidential: {person.name} won't know it was you. They'll also be
                  blocked, so you won't see each other again.
                </Text>
                <Text style={styles.label}>What happened?</Text>
                <ChoiceChips options={REPORT_REASONS} selected={reason} onChange={setReason} single />
                <TextInput
                  style={styles.input}
                  placeholder={reason[0] === "other" ? "Tell us what happened" : "Anything else we should know? (optional)"}
                  placeholderTextColor={colors.textFaint}
                  multiline
                  maxLength={1000}
                  value={details}
                  onChangeText={setDetails}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                {button("Submit report", submitReport, "danger")}
                {button("Back", () => setStep("menu"))}
              </>
            )}

            {step === "confirm-block" && (
              <>
                <Text style={styles.title}>Block {person.name}?</Text>
                <Text style={styles.body}>
                  You won't see each other on RunStride again, and any conversation will end. They
                  won't be told.
                </Text>
                {error && <Text style={styles.error}>{error}</Text>}
                {button("Block", () => run(() => blockUser(token!, person.id), () => onDone("blocked")), "danger")}
                {button("Back", () => setStep("menu"))}
              </>
            )}

            {step === "confirm-unmatch" && matchId && (
              <>
                <Text style={styles.title}>Unmatch {person.name}?</Text>
                <Text style={styles.body}>You'll both lose this conversation and won't see each other again.</Text>
                {error && <Text style={styles.error}>{error}</Text>}
                {button("Unmatch", () => run(() => unmatch(token!, matchId), () => onDone("unmatched")), "danger")}
                {button("Back", () => setStep("menu"))}
              </>
            )}

            {step === "reported" && (
              <>
                <Text style={styles.title}>Thanks for telling us</Text>
                <Text style={styles.body}>
                  Our team reviews every report. {person.name} has been blocked, so you won't see
                  each other again.
                </Text>
                <View style={styles.emergency}>
                  <Text style={styles.emergencyText}>
                    If you're in danger right now, call the police on 10111, or 112 from any mobile.
                  </Text>
                </View>
                {button("Done", () => onDone("reported"), "primary")}
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  scroll: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, width: "100%", maxWidth: 420 },
  title: { color: colors.heading, fontSize: 20, fontWeight: "700", marginBottom: 12 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22, marginBottom: 16 },
  label: { color: colors.heading, fontSize: 15, fontWeight: "600", marginBottom: 10 },
  input: {
    backgroundColor: colors.bg,
    color: colors.heading,
    borderRadius: 12,
    padding: 14,
    minHeight: 90,
    textAlignVertical: "top",
    fontSize: 15,
    marginTop: -8,
    marginBottom: 16,
  },
  error: { color: colors.dangerText, fontSize: 14, marginBottom: 12, textAlign: "center" },
  button: { paddingVertical: 13, borderRadius: 999, alignItems: "center", marginTop: 8 },
  buttonText: { color: colors.textBright, fontSize: 16 },
  primary: { backgroundColor: colors.primary },
  primaryText: { color: colors.onPrimary, fontWeight: "600" },
  danger: { backgroundColor: colors.danger },
  dangerText: { color: colors.heading, fontWeight: "600" },
  emergency: {
    borderColor: colors.warning,
    borderWidth: 1,
    backgroundColor: colors.warningTint,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  emergencyText: { color: colors.warningSoft, fontSize: 14, lineHeight: 20 },
});
