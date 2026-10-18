// Sends app crashes and errors to the server (POST /client-errors), which logs them and passes them to
// Sentry when that's set up. Nothing personal is sent: the message, where it happened, and the platform.
import { Platform } from "react-native";
import { API_BASE_URL } from "./api";

const MAX_PER_SESSION = 5; // one broken screen shouldn't send hundreds
let sent = 0;
let installed = false;

function screen(): string | undefined {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.pathname;
  return undefined;
}

export function reportError(error: unknown, fatal = false) {
  if (sent >= MAX_PER_SESSION) return;
  sent++;
  const err = error instanceof Error ? error : new Error(String(error));
  fetch(`${API_BASE_URL}/client-errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: (err.message || "Unknown error").slice(0, 1000),
      stack: err.stack?.slice(0, 8000),
      platform: Platform.OS,
      screen: screen(),
      fatal,
    }),
  }).catch(() => {}); // reporting must never cause another error
}

// Catches errors nothing else handled. Call once, when the app starts.
export function installErrorReporting() {
  if (installed || __DEV__) return; // in development the red screen already shows errors
  installed = true;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("error", (e) => reportError(e.error ?? e.message));
    window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
    return;
  }
  const g = globalThis as unknown as {
    ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
  };
  const previous = g.ErrorUtils?.getGlobalHandler();
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportError(e, !!fatal);
    previous?.(e, fatal);
  });
}
