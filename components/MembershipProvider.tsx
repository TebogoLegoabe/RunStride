// What the signed-in user has: Plus, race passes, Taken mode. Screens read it to show the
// right state; the server enforces every limit regardless.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getMembership } from "../lib/api";
import type { Membership } from "../lib/types";
import { useChat } from "./ChatProvider";

type MembershipContextValue = {
  membership: Membership | null;
  refresh: () => Promise<void>;
  // After an action that returns the new membership (a purchase, switching mode)
  update: (membership: Membership) => void;
  // Plus, or a race pass for this race
  hasRaceAccess: (raceId: string) => boolean;
};

const MembershipContext = createContext<MembershipContextValue | null>(null);

export function MembershipProvider({ children }: { children: ReactNode }) {
  const { token, subscribe } = useChat();
  const [membership, setMembership] = useState<Membership | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setMembership(await getMembership(token));
    } catch {
      // keep what we had; the next refresh will catch up
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reconnected (e.g. back from the background): a store purchase may have landed meanwhile
  useEffect(() => subscribe((e) => e.type === "ready" && refresh()), [subscribe, refresh]);

  const hasRaceAccess = useCallback(
    (raceId: string) => !!membership && (membership.plus.active || membership.racePasses.some((p) => p.raceId === raceId)),
    [membership]
  );

  return (
    <MembershipContext.Provider value={{ membership, refresh, update: setMembership, hasRaceAccess }}>
      {children}
    </MembershipContext.Provider>
  );
}

export function useMembership(): MembershipContextValue {
  const value = useContext(MembershipContext);
  if (!value) throw new Error("useMembership must be used inside MembershipProvider");
  return value;
}
