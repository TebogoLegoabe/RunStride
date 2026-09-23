import type { Gender, Goal, RunTime, Terrain } from "./options";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

export interface VerificationState {
  status: VerificationStatus;
  attemptsRemaining: number;
  canStart: boolean; // a new attempt, or resuming an unfinished one
}

// Another runner, as shown in the discover feed
export interface DiscoverCard {
  userId: string;
  displayName: string;
  age: number;
  bio: string | null;
  photos: string[];
  distanceKm: number; // approximate: locations are stored rounded to ~1 km
  verified: boolean;
  compatibility: number; // 0-100 running compatibility
  paceSecondsPerKm: number;
  weeklyKm: number;
  terrains: Terrain[];
  goals: Goal[];
  runTimes: RunTime[];
}

export interface MatchSummary {
  id: string;
  userId: string;
  displayName: string;
  photo: string | null;
  matchedAt: string;
}

export interface SwipeResult {
  matched: boolean;
  match: MatchSummary | null;
}

export interface Me {
  id: string;
  phone: string;
  verificationStatus: VerificationStatus;
  verificationRequired: boolean; // false only in development while ID verification is off
  profileComplete: boolean;
  hasRunningProfile: boolean;
  hasDatingPreferences: boolean;
  hasLocation: boolean;
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

// Planned for the run-date feature; not backed by the API yet
export interface RunDate {
  id: string;
  matchId: string;
  location: { lat: number; lng: number; label: string };
  scheduledFor: string;
  status: "proposed" | "confirmed" | "completed" | "cancelled";
}
