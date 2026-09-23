import type { Gender, Goal, ReportReason, RunTime, Terrain } from "./options";

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
  userId: string; // the other person
  displayName: string;
  photo: string | null;
  matchedAt: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
}

export interface RunDate {
  id: string;
  matchId: string;
  proposedById: string;
  startsAt: string;
  place: string;
  distanceKm: number | null;
  note: string | null;
  status: "proposed" | "accepted" | "declined" | "cancelled";
  respondedAt: string | null;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  // text: typed. run_date: a run suggestion card. system: e.g. "Accepted the run"
  kind: "text" | "run_date" | "system";
  body: string;
  createdAt: string;
  readAt: string | null;
  runDate: RunDate | null;
}

// Pushed by the server over the WebSocket
export type RealtimeEvent =
  | { type: "ready" }
  | { type: "pong" }
  | { type: "message"; message: Message }
  | { type: "read"; matchId: string; readAt: string }
  | { type: "match_ended"; matchId: string }
  | { type: "run_date"; runDate: RunDate };

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
  isAdmin: boolean;
}

export type ModerationAction = "dismiss" | "warn" | "suspend" | "ban";

// Moderation queue (admins only)
export interface ReportSummary {
  id: string;
  reason: ReportReason;
  details: string | null;
  status: "open" | "resolved";
  createdAt: string;
  reporter: { id: string | null; displayName: string | null };
  reported: {
    id: string | null; // null if they've deleted their account
    displayName: string | null;
    accountStatus: "active" | "suspended" | "banned" | null;
    openReportCount: number;
    totalReportCount: number;
  };
  resolution: ModerationAction | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
}

export interface ReportDetail extends ReportSummary {
  // Copied when the report was made
  evidence: {
    capturedAt: string;
    profile: { displayName: string | null; bio: string | null; photos: string[] };
    messages: { fromReported: boolean; body: string; createdAt: string }[];
  };
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

