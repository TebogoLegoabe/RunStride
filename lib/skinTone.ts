// Emoji skin tones. People pick one in the emoji panel; it's remembered on this device and used
// for every emoji that has tones (hands, runners), in messages and reactions alike.
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { SKIN_TONES, type SkinTone } from "./emojiTone";

export { SKIN_TONES, hasTones, withTone, type SkinTone } from "./emojiTone";

const KEY = "runstride.skinTone";

let current: SkinTone = "";
let loaded = false;
const listeners = new Set<(t: SkinTone) => void>();

async function load(): Promise<SkinTone> {
  if (loaded) return current;
  try {
    const raw = Platform.OS === "web" ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (raw && (SKIN_TONES as readonly string[]).includes(raw)) current = raw as SkinTone;
  } catch {
    // default tone
  }
  loaded = true;
  return current;
}

export function setSkinTone(tone: SkinTone) {
  current = tone;
  loaded = true;
  listeners.forEach((l) => l(tone));
  try {
    if (Platform.OS === "web") localStorage.setItem(KEY, tone);
    else SecureStore.setItemAsync(KEY, tone).catch(() => {});
  } catch {
    // remembered for this session only
  }
}

// The chosen tone, updating everywhere when it changes
export function useSkinTone(): SkinTone {
  const [tone, setTone] = useState<SkinTone>(current);
  useEffect(() => {
    load().then(setTone);
    listeners.add(setTone);
    return () => {
      listeners.delete(setTone);
    };
  }, []);
  return tone;
}
