// Web version of lib/push.ts: browser notifications through Web Push and the service worker in
// public/sw.js. Browsers only allow asking for permission after a tap, so asking happens from
// enableWebPush() (the "Turn on notifications" card); everything else stays quiet.
import { getWebPushKey, removeWebPush, saveWebPush } from "./api";

export type PushSupport = "ok" | "web" | "simulator" | "expo-go" | "not-configured";
// on: notifications will arrive. off: not asked yet. ios-install: iPhone needs RunStride on the Home Screen first.
export type WebPushState = "on" | "off" | "denied" | "ios-install" | "unsupported" | "not-configured";

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const isIos = () => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js");
}

// Subscribes this browser (permission must already be granted) and tells the server
async function subscribe(apiToken: string): Promise<WebPushState> {
  let publicKey: string;
  try {
    publicKey = (await getWebPushKey()).publicKey;
  } catch {
    return "not-configured";
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await saveWebPush(apiToken, { endpoint: json.endpoint, keys: json.keys });
  return "on";
}

export async function webPushState(): Promise<WebPushState> {
  if (!supported()) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

// From a tap: ask permission, then subscribe
export async function enableWebPush(apiToken: string): Promise<WebPushState> {
  if (!supported()) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  return subscribe(apiToken);
}

export function pushSupport(): PushSupport {
  return "web";
}

// Called when the app opens: keeps an existing subscription linked to this account. Never asks.
export async function registerForPush(apiToken: string): Promise<PushSupport | "denied"> {
  try {
    if (supported() && Notification.permission === "granted") await subscribe(apiToken);
  } catch {
    // the next visit tries again
  }
  return "web";
}

// Signing out: this browser stops getting this account's notifications
export async function unregisterPush(apiToken: string): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await removeWebPush(apiToken, sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch {
    // nothing to undo
  }
}

// Tapping a notification while RunStride is open moves to that screen (see public/sw.js)
export function onNotificationTap(open: (url: string) => void): () => void {
  if (!supported()) return () => {};
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type === "open" && typeof data.url === "string" && data.url.startsWith("/")) open(data.url);
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
