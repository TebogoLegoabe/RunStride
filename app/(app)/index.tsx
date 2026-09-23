import { View, Text, StyleSheet } from "react-native";

export default function Discover() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Discover feed goes here</Text>
      {/* TODO: fetch(GET /matches/discover) and render swipeable cards
          using running-compatibility + dating-preference filters */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  text: { color: "#94a3b8" },
});
