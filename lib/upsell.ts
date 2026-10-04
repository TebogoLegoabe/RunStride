// When the server says something needs Plus (HTTP 402), open the Plus screen with its reason.
import type { useRouter } from "expo-router";
import { ApiError } from "./api";

export const isUpgradeError = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 402;

type Router = ReturnType<typeof useRouter>;

// raceId / raceName: also offer a race pass for that race
export function openPlus(router: Router, options: { reason?: string; raceId?: string; raceName?: string } = {}) {
  router.push({
    pathname: "/plus",
    params: {
      ...(options.reason ? { reason: options.reason } : {}),
      ...(options.raceId ? { raceId: options.raceId, raceName: options.raceName ?? "" } : {}),
    },
  });
}
