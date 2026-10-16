import { View, Pressable, StyleSheet } from "react-native";
import { Text, TextInput } from "./ui/Text";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest } from "../lib/api";
import { colors, radius } from "../lib/theme";

const MAX_CLUBS = 3;

type Props = { token: string | null; clubs: string[]; onChange: (clubs: string[]) => void };

const sameClub = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Running clubs or groups, up to three: type one, or tap a suggestion
export function ClubPicker({ token, clubs, onChange }: Props) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    const id = setTimeout(() => {
      apiRequest<string[]>(`/me/clubs/suggest?q=${encodeURIComponent(text.trim())}`, { token })
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(id);
  }, [token, text]);

  const add = (name: string) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2 || clubs.length >= MAX_CLUBS || clubs.some((c) => sameClub(c, clean))) return;
    onChange([...clubs, clean]);
    setText("");
  };

  const remaining = suggestions.filter((s) => !clubs.some((c) => sameClub(c, s)));

  return (
    <View>
      {clubs.length > 0 && (
        <View style={styles.row}>
          {clubs.map((club) => (
            <Pressable
              key={club}
              style={styles.chosen}
              onPress={() => onChange(clubs.filter((c) => c !== club))}
              accessibilityLabel={`Remove ${club}`}
            >
              <Ionicons name="people" size={14} color={colors.onPrimary} />
              <Text style={styles.chosenText}>{club}</Text>
              <Ionicons name="close" size={14} color={colors.onPrimary} />
            </Pressable>
          ))}
        </View>
      )}
      {clubs.length < MAX_CLUBS && (
        <>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Type your club, e.g. Hout Bay Harriers"
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              maxLength={60}
              onSubmitEditing={() => add(text)}
              returnKeyType="done"
            />
            <Pressable
              style={[styles.addButton, text.trim().length < 2 && styles.addDisabled]}
              onPress={() => add(text)}
              disabled={text.trim().length < 2}
              accessibilityLabel="Add club"
            >
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
          {remaining.length > 0 && (
            <View style={styles.row}>
              {remaining.map((s) => (
                <Pressable key={s} style={styles.suggestion} onPress={() => add(s)}>
                  <Text style={styles.suggestionText}>+ {s}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  chosen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chosenText: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.heading, borderRadius: 12, padding: 14, fontSize: 15 },
  addButton: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 18, justifyContent: "center" },
  addDisabled: { opacity: 0.4 },
  addText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  suggestion: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12 },
  suggestionText: { color: colors.text, fontSize: 13 },
});
