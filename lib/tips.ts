// Remembers which one-time safety tips someone has already dismissed. Best effort: if storage
// isn't available the tip simply shows again.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const key = (id: string) => `runstride.tip.${id.replace(/[^A-Za-z0-9._-]/g, "_")}`;

export async function tipDismissed(id: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") return localStorage.getItem(key(id)) === "1";
    return (await SecureStore.getItemAsync(key(id))) === "1";
  } catch {
    return false;
  }
}

export async function dismissTip(id: string): Promise<void> {
  try {
    if (Platform.OS === "web") localStorage.setItem(key(id), "1");
    else await SecureStore.setItemAsync(key(id), "1");
  } catch {
    // ignore: the tip will just show again
  }
}
