import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Text } from "../ui/Text";
import { mediaUrl } from "../../lib/api";
import { colors, fonts } from "../../lib/theme";

type Props = {
  id: string; // shapes the waveform, so each note looks different but always the same
  url: string;
  durationMs: number | null;
  mine: boolean;
};

const BARS = 28;
const SPEEDS = [1, 1.5, 2] as const;

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A made-up but steady waveform: the recording's real levels aren't stored
function bars(seed: string): number[] {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const wave = Math.sin((i / BARS) * Math.PI); // louder in the middle
    return 0.25 + 0.75 * (((h >>> 16) % 100) / 100) * (0.5 + 0.5 * wave);
  });
}

// A voice message: play/pause, a waveform that fills as it plays (tap it to jump), and speed
export function VoiceNote({ id, url, durationMs, mine }: Props) {
  const player = useAudioPlayer(mediaUrl(url));
  const status = useAudioPlayerStatus(player);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [width, setWidth] = useState(0);
  const shape = useMemo(() => bars(id), [id]);

  const total = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
  const progress = total > 0 ? Math.min(1, status.currentTime / total) : 0;

  // Played to the end: back to the start, ready to play again
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      player.seekTo(0).catch(() => {});
    }
  }, [status.didJustFinish, player]);

  const toggle = () => (status.playing ? player.pause() : player.play());
  const nextSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    player.setPlaybackRate(next);
  };

  const ink = mine ? colors.onPrimary : colors.primary;
  const faint = mine ? colors.onPrimaryMuted : colors.textFaint;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={toggle}
        style={[styles.play, { backgroundColor: mine ? colors.onPrimary : colors.primary }]}
        accessibilityLabel={status.playing ? "Pause voice message" : "Play voice message"}
        hitSlop={6}
      >
        <Ionicons
          name={status.playing ? "pause" : "play"}
          size={18}
          color={mine ? colors.primary : colors.onPrimary}
          style={!status.playing && styles.playIcon}
        />
      </Pressable>
      <View style={styles.middle}>
        <Pressable
          style={styles.wave}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          onPress={(e) => total > 0 && width > 0 && player.seekTo((e.nativeEvent.locationX / width) * total)}
          accessibilityLabel="Jump to a point in the voice message"
        >
          {shape.map((level, i) => (
            <View
              key={i}
              style={[styles.bar, { height: 4 + level * 18, backgroundColor: i / BARS <= progress && progress > 0 ? ink : faint }]}
            />
          ))}
        </Pressable>
        <Text style={[styles.time, { color: faint }]}>
          {clock(status.playing || status.currentTime > 0 ? status.currentTime : total)}
        </Text>
      </View>
      <Pressable onPress={nextSpeed} style={[styles.speed, { borderColor: faint }]} accessibilityLabel="Playback speed" hitSlop={6}>
        <Text style={[styles.speedText, { color: ink }]}>{speed}×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 220, paddingVertical: 2 },
  play: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  playIcon: { marginLeft: 2 },
  middle: { flex: 1 },
  wave: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 26 },
  bar: { width: 3, borderRadius: 2 },
  time: { fontSize: 11, marginTop: 2 },
  speed: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  speedText: { fontSize: 11, fontFamily: fonts.bold },
});
