import { View, Text, StyleSheet } from "react-native";
import { useEffect, useState } from "react";
import { getMe } from "../../lib/api";
import { getToken } from "../../lib/session";

export default function Discover() {
  const [unverified, setUnverified] = useState(false);

  // Only reachable unverified while ID verification is switched off in development
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return;
      const me = await getMe(token).catch(() => null);
      setUnverified(me !== null && me.verificationStatus !== "verified");
    })();
  }, []);

  return (
    <View style={styles.container}>
      {unverified && (
        <View style={styles.devBanner}>
          <Text style={styles.devBannerTitle}>ID verification: in development</Text>
          <Text style={styles.devBannerText}>
            You're in without verifying for now. Before launch, everyone will verify
            their ID and a selfie before they can match.
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.text}>Discover feed goes here</Text>
        {/* TODO: fetch(GET /matches/discover) and render swipeable cards
            using running-compatibility + dating-preference filters */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  devBanner: {
    margin: 16,
    marginTop: 48,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    alignSelf: "center",
    maxWidth: 560,
    width: "92%",
  },
  devBannerTitle: { color: "#fbbf24", fontWeight: "700", fontSize: 14, marginBottom: 4 },
  devBannerText: { color: "#fde68a", fontSize: 13, lineHeight: 19 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { color: "#94a3b8" },
});
