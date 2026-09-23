import { View, Text, Pressable, StyleSheet } from "react-native";

type Props<T extends string> = {
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  // Single choice: tapping a chip replaces the selection instead of toggling it
  single?: boolean;
};

export function ChoiceChips<T extends string>({ options, selected, onChange, single }: Props<T>) {
  const toggle = (value: T) => {
    if (single) {
      onChange([value]);
    } else if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <View style={styles.row}>
      {options.map(({ value, label }) => {
        const on = selected.includes(value);
        return (
          <Pressable
            key={value}
            onPress={() => toggle(value)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole={single ? "radio" : "checkbox"}
            accessibilityState={single ? { selected: on } : { checked: on }}
          >
            <Text style={[styles.label, on && styles.labelOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#1e293b",
  },
  chipOn: { backgroundColor: "#4ecdc4", borderColor: "#4ecdc4" },
  label: { color: "#cbd5e1", fontSize: 14 },
  labelOn: { color: "#0f172a", fontWeight: "600" },
});
