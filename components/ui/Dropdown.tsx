import { useState } from "react";
import { View, Pressable, StyleSheet, Modal, ScrollView, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { hoverable } from "../../lib/responsive";
import { haptics } from "../../lib/haptics";
import { colors, fonts, radius } from "../../lib/theme";

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  // Small caption above the value, e.g. "Province"
  label: string;
  options: readonly Option<T>[];
  selected: readonly T[];
  onChange: (selected: T[]) => void;
  // Pick several (shows a Done button). Default: pick one and the list closes.
  multiple?: boolean;
  // What the field says when nothing is chosen (multiple only)
  emptyLabel?: string;
  style?: StyleProp<ViewStyle>;
};

// A filter field: shows the current choice, opens a list to change it. Replaces rows of chips where
// there are more than a few options, so filters stay one tidy line.
export function Dropdown<T extends string>({ label, options, selected, onChange, multiple, emptyLabel = "Any", style }: Props<T>) {
  const [open, setOpen] = useState(false);

  const chosen = options.filter((o) => selected.includes(o.value));
  const value = chosen.length === 0 ? emptyLabel : chosen.length === 1 ? chosen[0].label : `${chosen.length} selected`;
  const active = multiple ? chosen.length > 0 : selected.length > 0 && chosen.length > 0 && options[0]?.value !== chosen[0]?.value;

  const pick = (v: T) => {
    haptics.tap();
    if (!multiple) {
      onChange([v]);
      setOpen(false);
    } else {
      onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Change`}
        style={hoverable(({ hovered, pressed }) => [
          styles.field,
          active && styles.fieldOn,
          (hovered || pressed) && styles.fieldHot,
          style,
        ])}
      >
        <View style={styles.fieldText}>
          <Text style={styles.caption}>{label}</Text>
          <Text style={[styles.value, active && styles.valueOn]} numberOfLines={1}>
            {value}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={active ? colors.primary : colors.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Animated.View entering={FadeIn.duration(150)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close" />
          <Animated.View entering={SlideInDown.duration(220)} style={styles.sheet}>
            <View style={styles.grab} />
            <Text style={styles.title}>{label}</Text>
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {options.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => pick(o.value)}
                    accessibilityRole={multiple ? "checkbox" : "radio"}
                    accessibilityState={multiple ? { checked: on } : { selected: on }}
                    style={hoverable(({ hovered, pressed }) => [styles.row, (hovered || pressed) && styles.rowHot])}
                  >
                    <Text style={[styles.rowText, on && styles.rowTextOn]}>{o.label}</Text>
                    {on && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
            {multiple && (
              <View style={styles.actions}>
                {selected.length > 0 && (
                  <Pressable onPress={() => onChange([])} style={styles.clear}>
                    <Text style={styles.clearText}>Clear</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setOpen(false)} style={styles.done}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 130,
    flexGrow: 1,
    flexBasis: 130,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  fieldOn: { borderColor: colors.primary, backgroundColor: colors.primaryTintSoft },
  fieldHot: { opacity: 0.9 },
  fieldText: { flex: 1 },
  caption: { color: colors.textFaint, fontSize: 11, fontFamily: fonts.bold, textTransform: "uppercase" },
  value: { color: colors.heading, fontSize: 14, marginTop: 1 },
  valueOn: { color: colors.primary, fontFamily: fonts.bold },
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: "flex-end", alignItems: "center" },
  sheet: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "75%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 8,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: 10 },
  title: { color: colors.heading, fontSize: 17, fontFamily: fonts.bold, paddingHorizontal: 12, marginBottom: 6 },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: radius.md,
  },
  rowHot: { backgroundColor: colors.primaryTintSoft },
  rowText: { color: colors.text, fontSize: 16, flex: 1 },
  rowTextOn: { color: colors.primary, fontFamily: fonts.bold },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, paddingHorizontal: 12, paddingTop: 8 },
  clear: { padding: 10 },
  clearText: { color: colors.textMuted, fontSize: 15 },
  done: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 26 },
  doneText: { color: colors.onPrimary, fontSize: 15, fontFamily: fonts.bold },
});
