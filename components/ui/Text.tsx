// Drop-in replacements for React Native's Text and TextInput that use the brand font.
// Styles keep using fontWeight as usual; it's translated to the matching Plus Jakarta Sans
// file (Android can't synthesise weights from one font file, so each weight is its own family).
import { forwardRef } from "react";
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { fonts } from "../../lib/theme";

function familyFor(weight: TextStyle["fontWeight"]): string {
  switch (String(weight ?? "400")) {
    case "500":
    case "medium":
      return fonts.medium;
    case "600":
    case "semibold":
      return fonts.semibold;
    case "700":
    case "bold":
      return fonts.bold;
    case "800":
    case "900":
    case "heavy":
    case "black":
      return fonts.extrabold;
    default:
      return fonts.regular;
  }
}

function withBrandFont(style: TextProps["style"]) {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style; // an explicit family wins
  // fontWeight is dropped: the weight now comes from the font file itself
  const { fontWeight, ...rest } = flat;
  return [rest, { fontFamily: familyFor(fontWeight) }];
}

export const Text = forwardRef<RNText, TextProps>(function Text({ style, ...props }, ref) {
  return <RNText ref={ref} style={withBrandFont(style)} {...props} />;
});

export const TextInput = forwardRef<RNTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} style={withBrandFont(style)} {...props} />;
});
