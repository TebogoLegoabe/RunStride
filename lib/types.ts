import type { Gender, Goal, RunTime, Terrain } from "./options";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export interface VerificationState {
  status: VerificationStatus;
  attemptsRemaining: number;
  canStart: boolean; // a new attempt, or resuming an unfinished one
}

export interface Me {
  id: string;
  phone: string;
  verificationStatus: VerificationStatus;
  verificationRequired: boolean; // false only in development while ID verification is off
  profileComplete: boolean;
  hasRunningProfile: boolean;
  hasDatingPreferences: boolean;
}

export interface RunningProfile {
  paceSecondsPerKm: number; // e.g. 330 = 5:30 min/km
  weeklyKm: number;
  terrains: Terrain[];
  goals: Goal[];
  runTimes: RunTime[];
}

export interface DatingPreferences {
  gender: Gender;
  interestedIn: Gender[];
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number;
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
