// Layout for sign-in screens: full screen on phones, a centered card on tablets and computers.
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { colors, radius, shadow } from "../../lib/theme";
import { useBreakpoint } from "../../lib/responsive";

export function AuthCard({ children }: { children: React.ReactNode }) {
  const { isPhone } = useBreakpoint();
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!isPhone && (
          <Image
            source={require("../../assets/logo.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="RunStride"
          />
        )}
        <View style={[styles.column, !isPhone && styles.card]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  column: { width: "100%", maxWidth: 440 },
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: 36,
    ...shadow.card,
  },
  // The logo art is 364x343
  logo: { width: 84, height: 79, marginBottom: 24 },
});
