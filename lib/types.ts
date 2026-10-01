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
  sharedRaces: SharedRace[]; // upcoming races you're both going to
}

export interface MatchSummary {
  id: string;
  userId: string; // the other person
  displayName: string;
  photo: string | null;
  matchedAt: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  kind: "dating" | "race";
  originRaceName: string | null; // for race chats: where you met
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
  | { type: "run_date"; runDate: RunDate }
  | { type: "race_message"; message: RaceMessage }
  | { type: "race_message_removed"; raceId: string; messageId: string }
  | { type: "chat_request"; requestId: string }
  | { type: "chat_request_accepted"; requestId: string; matchId: string };

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


export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
}

export interface RunShare {
  id: string;
  status: "active" | "alert" | "ended" | "expired";
  url: string; // the private tracking page to send to trusted contacts
  startedAt: string;
  expiresAt: string;
  alertAt: string | null;
  locationAt: string | null;
}

// Everything the run safety screen needs for one run
export interface RunSafety {
  run: RunDate;
  otherUserId: string;
  otherName: string;
  shareOpensAt: string;
  shareClosesAt: string;
  share: RunShare | null;
  trustedContacts: TrustedContact[];
  checkIn: "ok" | "problem" | null;
}

// --- Races ---
export type SwapWindow = "open" | "upcoming" | "closed" | "none";
export type AttendanceRole = "running" | "supporting";

export interface SharedRace {
  raceId: string;
  name: string;
  startsOn: string;
  eventLabel: string | null;
}

export interface MyAttendance {
  role: AttendanceRole;
  raceEventId: string | null;
  eventLabel: string | null;
}

export interface RaceSummary {
  id: string;
  name: string;
  startsOn: string; // YYYY-MM-DD, South African date
  endsOn: string;
  venue: string;
  city: string;
  province: string | null;
  status: "published" | "pending" | "rejected";
  attendingCount: number;
  myAttendance: MyAttendance | null;
}

export interface RaceEvent {
  id: string;
  label: string;
  distanceKm: number;
  startsAt: string | null;
  runnerCount: number;
}

export interface RaceDetail extends RaceSummary {
  officialUrl: string | null;
  substitutionOpensOn: string | null;
  substitutionClosesOn: string | null;
  substitutionUrl: string | null;
  swapWindow: SwapWindow;
  events: RaceEvent[];
}

export interface Person {
  id: string;
  displayName: string;
  photo: string | null;
}

export interface Attendee {
  userId: string;
  displayName: string;
  age: number;
  photo: string | null;
  verified: boolean;
  role: AttendanceRole;
  eventLabel: string | null;
  connection: "none" | "requested" | "incoming" | "connected";
  matchId: string | null;
  requestId: string | null;
}

export interface RaceMessage {
  id: string;
  raceId: string;
  sender: Person;
  body: string;
  createdAt: string;
}

export interface Listing {
  id: string;
  raceId: string;
  kind: "offering" | "looking";
  raceEventId: string | null;
  eventLabel: string | null;
  priceRands: number | null;
  note: string | null;
  status: "open" | "closed";
  createdAt: string;
  user: Person;
  mine: boolean;
}

export interface ChatRequest {
  id: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  note: string | null;
  raceId: string | null;
  raceName: string | null;
  listingKind: "offering" | "looking" | null;
  other: Person;
  incoming: boolean;
  matchId: string | null;
}

// Admins creating or editing a race
export interface RaceInput {
  name: string;
  startsOn: string;
  endsOn?: string;
  venue: string;
  city: string;
  province?: string | null;
  officialUrl?: string | null;
  substitutionOpensOn?: string | null;
  substitutionClosesOn?: string | null;
  substitutionUrl?: string | null;
  events: { id?: string; label: string; distanceKm: number; startsAt?: string | null }[];
}
