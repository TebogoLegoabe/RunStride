// Numbered page controls: ‹ 1 … 4 5 6 … 12 ›
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./Text";
import { colors, fonts, radius } from "../../lib/theme";
import { hoverable } from "../../lib/responsive";
import { haptics } from "../../lib/haptics";

type Props = {
  page: number; // zero-based
  pageCount: number;
  onChange: (page: number) => void;
  disabled?: boolean;
};

// Which page numbers to show: always the first and last, and the current page with its
// neighbours. null marks a gap.
export function pageItems(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i);
  const near = new Set([0, pageCount - 1, page - 1, page, page + 1]);
  // Near either end, show a few more instead of a gap of just one page
  if (page <= 3) [1, 2, 3, 4].forEach((p) => near.add(p));
  if (page >= pageCount - 4) [1, 2, 3, 4].forEach((p) => near.add(pageCount - 1 - p));
  const pages = [...near].filter((p) => p >= 0 && p < pageCount).sort((a, b) => a - b);
  const items: (number | null)[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) items.push(null);
    items.push(p);
  });
  return items;
}

export function Pagination({ page, pageCount, onChange, disabled }: Props) {
  if (pageCount <= 1) return null;
  const go = (p: number) => {
    if (p === page || p < 0 || p >= pageCount || disabled) return;
    haptics.tap();
    onChange(p);
  };
  const arrow = (direction: -1 | 1) => {
    const off = direction === -1 ? page === 0 : page === pageCount - 1;
    return (
      <Pressable
        onPress={() => go(page + direction)}
        disabled={off || disabled}
        accessibilityRole="button"
        accessibilityLabel={direction === -1 ? "Previous page" : "Next page"}
        style={hoverable(({ hovered }) => [styles.item, hovered && !off && styles.itemHover, off && styles.off])}
      >
        <Ionicons name={direction === -1 ? "chevron-back" : "chevron-forward"} size={18} color={colors.text} />
      </Pressable>
    );
  };

  return (
    <View style={styles.row} accessibilityRole="toolbar">
      {arrow(-1)}
      {pageItems(page, pageCount).map((p, i) =>
        p === null ? (
          <Text key={`gap-${i}`} style={styles.gap}>
            …
          </Text>
        ) : (
          <Pressable
            key={p}
            onPress={() => go(p)}
            accessibilityRole="button"
            accessibilityLabel={`Page ${p + 1}`}
            accessibilityState={{ selected: p === page }}
            style={hoverable(({ hovered }) => [
              styles.item,
              hovered && styles.itemHover,
              p === page && styles.current,
            ])}
          >
            <Text style={[styles.number, p === page && styles.numberCurrent]}>{p + 1}</Text>
          </Pressable>
        )
      )}
      {arrow(1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" },
  item: {
    minWidth: 40,
    height: 40,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHover: { backgroundColor: colors.surface },
  current: { backgroundColor: colors.primary, borderColor: colors.primary },
  off: { opacity: 0.35 },
  number: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
  numberCurrent: { color: colors.onPrimary, fontFamily: fonts.bold },
  gap: { color: colors.textFaint, fontSize: 14, paddingHorizontal: 2 },
});
