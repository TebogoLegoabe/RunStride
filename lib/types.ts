export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export interface RunningStats {
  averagePaceMinPerKm: number;
  weeklyDistanceKm: number;
  personalBestFiveKMinutes?: number;
  preferredTerrain: "road" | "trail" | "track" | "mixed";
}

export interface Profile {
  id: string;
  displayName: string;
  age: number;
  bio?: string;
  photos: string[];
  verificationStatus: VerificationStatus;
  stravaConnected: boolean;
  runningStats?: RunningStats;
  goals: string[]; // e.g. "5k", "marathon", "casual runs"
}

export interface Match {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: string;
}

export interface RunDate {
  id: string;
  matchId: string;
  location: { lat: number; lng: number; label: string };
  scheduledFor: string;
  status: "proposed" | "confirmed" | "completed" | "cancelled";
}
