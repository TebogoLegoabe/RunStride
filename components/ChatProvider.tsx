import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { getMatches } from "../lib/api";
import { RealtimeClient } from "../lib/realtime";
import { getToken } from "../lib/session";
import type { RealtimeEvent } from "../lib/types";

type ChatContextValue = {
  token: string | null;
  connected: boolean;
  unreadTotal: number;
  refreshUnread: () => void;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

// Holds the app's single live connection and the unread count for the tab badge.
// Wraps the signed-in part of the app.
export function ChatProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  // Screens' listeners live here, so subscribing works even before the connection exists
  const listeners = useRef(new Set<(event: RealtimeEvent) => void>());

  const refreshUnread = useCallback(() => {
    if (!token) return;
    getMatches(token)
      .then((matches) => setUnreadTotal(matches.reduce((sum, m) => sum + m.unreadCount, 0)))
      .catch(() => {}); // the badge can wait for the next event
  }, [token]);

  useEffect(() => {
    getToken().then(setToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    const c = new RealtimeClient(token);
    const offStatus = c.onStatus(setConnected);
    const offEvents = c.subscribe((event) => {
      listeners.current.forEach((l) => l(event));
      if (event.type !== "pong") refreshUnread();
    });
    c.start();
    const appState = AppState.addEventListener("change", (s) => {
      if (s === "active") c.reconnectNow();
    });
    return () => {
      offStatus();
      offEvents();
      appState.remove();
      c.stop();
    };
  }, [token, refreshUnread]);

  const subscribe = useCallback((listener: (event: RealtimeEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return (
    <ChatContext.Provider value={{ token, connected, unreadTotal, refreshUnread, subscribe }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat must be used inside <ChatProvider>");
  return value;
}
