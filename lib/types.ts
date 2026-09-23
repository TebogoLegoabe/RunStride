export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export interface Me {
  id: string;
  phone: string;
  verificationStatus: VerificationStatus;
  profileComplete: boolean;
}

export interface Photo {
  id: string;
  url: string;
  position: number;
}

// The signed-in user's own profile, as returned by /me/profile
export interface MyProfile {
  displayName: string;
  birthDate: string; // YYYY-MM-DD
  age: number;
  bio: string | null;
  photos: Photo[];
}

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
