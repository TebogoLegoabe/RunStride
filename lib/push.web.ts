// Web version of lib/push.ts: RunStride doesn't send browser push notifications, so these
// do nothing. On the web, new messages and alerts show while the site is open.
export type PushSupport = "ok" | "web" | "simulator" | "expo-go" | "not-configured";

export function pushSupport(): PushSupport {
  return "web";
}

export async function registerForPush(_apiToken: string): Promise<PushSupport | "denied"> {
  return "web";
}

export async function unregisterPush(_apiToken: string): Promise<void> {}

export function onNotificationTap(_open: (url: string) => void): () => void {
  return () => {};
}
