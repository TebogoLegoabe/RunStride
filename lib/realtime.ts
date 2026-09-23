// One WebSocket per signed-in session, delivering live chat events.
// Screens subscribe to events; on every (re)connect the server sends "ready",
// which is the cue for screens to fetch anything they missed while offline.

import { API_BASE_URL } from "./api";
import type { RealtimeEvent } from "./types";

type Listener = (event: RealtimeEvent) => void;
type StatusListener = (connected: boolean) => void;

const PING_INTERVAL_MS = 25_000; // keeps idle connections from being dropped by proxies
const MAX_RETRY_DELAY_MS = 30_000;
const AUTH_FAILED = 4401;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private attempt = 0;
  private stopped = true;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  connected = false;

  constructor(private token: string) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.setConnected(false);
  }

  // Reconnect now instead of waiting out the backoff (e.g. the app came back to the foreground)
  reconnectNow() {
    if (this.stopped || this.connected) return;
    this.clearTimers();
    this.ws?.close();
    this.open();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open() {
    const ws = new WebSocket(`${API_BASE_URL.replace(/^http/, "ws")}/ws`);
    this.ws = ws;

    // Auth goes in the first message rather than the URL, so tokens don't end up in logs
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: this.token }));

    ws.onmessage = (msg) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (event.type === "ready") {
        this.attempt = 0;
        this.setConnected(true);
        this.pingTimer = setInterval(() => ws.send(JSON.stringify({ type: "ping" })), PING_INTERVAL_MS);
      }
      this.listeners.forEach((l) => l(event));
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return; // an older socket we already replaced
      this.clearTimers();
      this.setConnected(false);
      if (this.stopped || e.code === AUTH_FAILED) return;
      // 1s, 2s, 4s ... up to 30s between attempts
      const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** this.attempt++);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.statusListeners.forEach((l) => l(connected));
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }
}
