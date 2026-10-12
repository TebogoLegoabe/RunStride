// Persists the auth token between app launches. Native uses the device
// keychain/keystore via SecureStore; web falls back to localStorage since
// SecureStore isn't available in the browser.

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "runstride.authToken";

export async function saveToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// A remembered phone: signing out keeps this, so signing back in within 30 days needs no new text.
const DEVICE_KEY = "runstride.deviceToken";

export async function saveDeviceToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(DEVICE_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(DEVICE_KEY, token);
}

export async function getDeviceToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return localStorage.getItem(DEVICE_KEY);
    return await SecureStore.getItemAsync(DEVICE_KEY);
  } catch {
    return null;
  }
}

export async function clearDeviceToken(): Promise<void> {
  try {
    if (Platform.OS === "web") localStorage.removeItem(DEVICE_KEY);
    else await SecureStore.deleteItemAsync(DEVICE_KEY);
  } catch {
    // nothing to forget
  }
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
