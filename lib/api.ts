// Central API client. Every screen should go through here rather than
// calling fetch() directly, so auth headers / base URL / error handling
// live in one place.

import type { ReportReason } from "./options";
import { photoFile } from "./photoFile";
import type {
  Attendee,
  ChatRequest,
  DatingPreferences,
  Listing,
  RaceDetail,
  RaceInput,
  RaceMessage,
  RaceSummary,
  DiscoverCard,
  MatchSummary,
  Message,
  SwipeResult,
  TrustedContact,
  ModerationAction,
  MyProfile,
  ReportDetail,
  ReportSummary,
  Photo,
  RunDate,
  RunSafety,
  RunShare,
  RunningProfile,
  VerificationState,
} from "./types";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// FastAPI errors look like {"detail": "..."} (or a list for validation errors).
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // not JSON
  }
  return res.status >= 500
    ? "Something went wrong on our side. Please try again."
    : "Something went wrong. Please check your details and try again.";
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string;
};

export async function apiRequest<T>(
  path: string,
  { method = "GET", body, token }: RequestOptions = {}
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Photos stored by the dev backend come back as "/media/..." paths
export const mediaUrl = (url: string) => (url.startsWith("/") ? `${API_BASE_URL}${url}` : url);

// --- Auth ---
// `phone` in the response is the normalized E.164 number; pass that to verifyOtp.
export const sendOtp = (phone: string) =>
  apiRequest<{ sent: boolean; phone: string }>("/auth/otp/send", {
    method: "POST",
    body: { phone },
  });

export const verifyOtp = (phone: string, code: string) =>
  apiRequest<{ token: string; userId: string; profileComplete: boolean }>("/auth/otp/verify", {
    method: "POST",
    body: { phone, code },
  });

export const getMe = (token: string) =>
  apiRequest<import("./types").Me>("/me", { token });

// Permanent: removes the account and everything tied to it (reports about the user are kept)
export const deleteAccount = (token: string) => apiRequest<void>("/me", { method: "DELETE", token });

// --- Profile ---
export type ProfileInput = { displayName: string; birthDate: string; bio: string };

// For "get my X" endpoints: null means the user hasn't saved one yet
const nullIfMissing = (e: unknown) => {
  if (e instanceof ApiError && e.status === 404) return null;
  throw e;
};

export const getMyProfile = (token: string) =>
  apiRequest<MyProfile>("/me/profile", { token }).catch(nullIfMissing);

export const saveMyProfile = (token: string, profile: ProfileInput) =>
  apiRequest<MyProfile>("/me/profile", { method: "PUT", body: profile, token });

export async function uploadPhoto(token: string, uri: string): Promise<Photo> {
  const form = new FormData();
  form.append("file", await photoFile(uri), "photo.jpg");

  // No Content-Type header: fetch sets the multipart boundary itself
  const res = await fetch(`${API_BASE_URL}/me/photos`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.json() as Promise<Photo>;
}

export const deletePhoto = (token: string, photoId: string) =>
  apiRequest<void>(`/me/photos/${photoId}`, { method: "DELETE", token });

// --- Preferences ---
export const getRunningProfile = (token: string) =>
  apiRequest<RunningProfile>("/me/running-profile", { token }).catch(nullIfMissing);

export const saveRunningProfile = (token: string, body: RunningProfile) =>
  apiRequest<RunningProfile>("/me/running-profile", { method: "PUT", body, token });

export const getDatingPreferences = (token: string) =>
  apiRequest<DatingPreferences>("/me/dating-preferences", { token }).catch(nullIfMissing);

export const saveDatingPreferences = (token: string, body: DatingPreferences) =>
  apiRequest<DatingPreferences>("/me/dating-preferences", { method: "PUT", body, token });

// --- Verification ---
export const getVerification = (token: string) =>
  apiRequest<VerificationState>("/verification", { token });

// Returns a single-use link to Persona's hosted ID + selfie flow
export const startIdVerification = (token: string) =>
  apiRequest<{ verificationUrl: string }>("/verification/start", {
    method: "POST",
    token,
  });

// Asks the backend to fetch the latest result from Persona
export const refreshVerification = (token: string) =>
  apiRequest<VerificationState>("/verification/refresh", { method: "POST", token });

// --- Discover & matching ---
// The server rounds this to ~1 km before storing it
export const updateLocation = (token: string, latitude: number, longitude: number) =>
  apiRequest<void>("/me/location", { method: "PUT", body: { latitude, longitude }, token });

// raceId: only people going to that race (you must be going too)
export const getDiscoverFeed = (token: string, raceId?: string) =>
  apiRequest<DiscoverCard[]>(`/discover${raceId ? `?race_id=${raceId}` : ""}`, { token });

export const likeRunner = (token: string, userId: string) =>
  apiRequest<SwipeResult>(`/discover/${userId}/like`, { method: "POST", token });

export const passRunner = (token: string, userId: string) =>
  apiRequest<SwipeResult>(`/discover/${userId}/pass`, { method: "POST", token });

export const getMatches = (token: string) => apiRequest<MatchSummary[]>("/matches", { token });

export const unmatch = (token: string, matchId: string) =>
  apiRequest<void>(`/matches/${matchId}`, { method: "DELETE", token });

// --- Chat ---
// Oldest-first. `before`: an older page. `after`: anything newer than that message.
export const getMessages = (
  token: string,
  matchId: string,
  cursor: { before?: string; after?: string } = {}
) => {
  const params = new URLSearchParams(cursor as Record<string, string>).toString();
  return apiRequest<Message[]>(`/matches/${matchId}/messages${params ? `?${params}` : ""}`, { token });
};

export const sendMessage = (token: string, matchId: string, body: string) =>
  apiRequest<Message>(`/matches/${matchId}/messages`, { method: "POST", body: { body }, token });

export const markRead = (token: string, matchId: string) =>
  apiRequest<void>(`/matches/${matchId}/read`, { method: "POST", token });

// --- Run dates ---
// Posts a run suggestion card into the chat. startsAt must include a timezone offset.
export const suggestRun = (
  token: string,
  matchId: string,
  run: { startsAt: string; place: string; distanceKm?: number; note?: string }
) => apiRequest<Message>(`/matches/${matchId}/run-dates`, { method: "POST", body: run, token });

export const answerRun = (token: string, runDateId: string, action: "accept" | "decline" | "cancel") =>
  apiRequest<RunDate>(`/run-dates/${runDateId}/${action}`, { method: "POST", token });

// --- Safety ---
export const blockUser = (token: string, userId: string) =>
  apiRequest<void>(`/users/${userId}/block`, { method: "POST", token });

// Reporting also blocks the person
export const reportUser = (
  token: string,
  report: { reportedUserId: string; matchId?: string; raceId?: string; reason: ReportReason; details?: string }
) => apiRequest<{ id: string }>("/reports", { method: "POST", body: report, token });

// --- Moderation (admins only) ---
export const getReports = (token: string, status: "open" | "resolved" = "open") =>
  apiRequest<ReportSummary[]>(`/admin/reports?status=${status}`, { token });

export const getReport = (token: string, reportId: string) =>
  apiRequest<ReportDetail>(`/admin/reports/${reportId}`, { token });

export const resolveReport = (
  token: string,
  reportId: string,
  body: { action: ModerationAction; note?: string; suspendDays?: number }
) => apiRequest<ReportDetail>(`/admin/reports/${reportId}/resolve`, { method: "POST", body, token });

// --- Run-day safety ---
export const getRunSafety = (token: string, runDateId: string) =>
  apiRequest<RunSafety>(`/run-dates/${runDateId}/safety`, { token });

export const addTrustedContact = (token: string, contact: { name: string; phone: string }) =>
  apiRequest<TrustedContact>("/me/trusted-contacts", { method: "POST", body: contact, token });

export const removeTrustedContact = (token: string, contactId: string) =>
  apiRequest<void>(`/me/trusted-contacts/${contactId}`, { method: "DELETE", token });

export const startSharing = (token: string, runDateId: string) =>
  apiRequest<RunShare>(`/run-dates/${runDateId}/share`, { method: "POST", token });

// Exact position, visible only through the share link while sharing
export const sendShareLocation = (
  token: string,
  shareId: string,
  position: { latitude: number; longitude: number; accuracyM?: number }
) => apiRequest<void>(`/shares/${shareId}/location`, { method: "PUT", body: position, token });

// The panic button
export const raiseAlert = (token: string, shareId: string) =>
  apiRequest<RunShare>(`/shares/${shareId}/alert`, { method: "POST", token });

export const stopSharing = (token: string, shareId: string) =>
  apiRequest<RunShare>(`/shares/${shareId}/end`, { method: "POST", token });

export const checkInRun = (token: string, runDateId: string, outcome: "ok" | "problem") =>
  apiRequest<void>(`/run-dates/${runDateId}/check-in`, { method: "POST", body: { outcome }, token });

// --- Races ---
export type RaceDistance = "5k" | "10k" | "half" | "marathon" | "ultra";

export type RaceFilters = {
  q?: string;
  mine?: boolean;
  province?: string;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;
  distances?: RaceDistance[];
  offset?: number;
  limit?: number;
};

// A page of upcoming races. A page shorter than `limit` is the last one.
export const getRaces = (token: string, filters: RaceFilters = {}) => {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.mine) params.set("mine", "true");
  if (filters.province) params.set("province", filters.province);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  filters.distances?.forEach((d) => params.append("distance", d));
  if (filters.offset) params.set("offset", String(filters.offset));
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return apiRequest<RaceSummary[]>(`/races${query ? `?${query}` : ""}`, { token });
};

export const getRace = (token: string, raceId: string) => apiRequest<RaceDetail>(`/races/${raceId}`, { token });

export const suggestRace = (
  token: string,
  race: { name: string; startsOn: string; venue: string; city: string; officialUrl?: string }
) => apiRequest<RaceSummary>("/races/suggestions", { method: "POST", body: race, token });

export const setAttendance = (
  token: string,
  raceId: string,
  attendance: { role: "running" | "supporting"; raceEventId?: string }
) => apiRequest<RaceDetail>(`/races/${raceId}/attendance`, { method: "PUT", body: attendance, token });

export const leaveRace = (token: string, raceId: string) =>
  apiRequest<RaceDetail>(`/races/${raceId}/attendance`, { method: "DELETE", token });

export const getAttendees = (token: string, raceId: string) =>
  apiRequest<Attendee[]>(`/races/${raceId}/attendees`, { token });

export const getRaceMessages = (token: string, raceId: string, before?: string) =>
  apiRequest<RaceMessage[]>(`/races/${raceId}/messages${before ? `?before=${before}` : ""}`, { token });

export const postRaceMessage = (token: string, raceId: string, body: string) =>
  apiRequest<RaceMessage>(`/races/${raceId}/messages`, { method: "POST", body: { body }, token });

export const getListings = (token: string, raceId: string) =>
  apiRequest<Listing[]>(`/races/${raceId}/listings`, { token });

export const createListing = (
  token: string,
  raceId: string,
  listing: { kind: "offering" | "looking"; raceEventId: string; priceRands?: number; note?: string }
) => apiRequest<Listing>(`/races/${raceId}/listings`, { method: "POST", body: listing, token });

export const closeListing = (token: string, listingId: string) =>
  apiRequest<void>(`/listings/${listingId}/close`, { method: "POST", token });

// --- Chat requests (private chats with people met through a race) ---
export const sendChatRequest = (
  token: string,
  request: { toUserId: string; raceId?: string; listingId?: string; note?: string }
) => apiRequest<ChatRequest>("/chat-requests", { method: "POST", body: request, token });

export const getChatRequests = (token: string) => apiRequest<ChatRequest[]>("/chat-requests", { token });

export const answerChatRequest = (token: string, requestId: string, answer: "accept" | "decline") =>
  apiRequest<ChatRequest>(`/chat-requests/${requestId}/${answer}`, { method: "POST", token });

// --- Race admin ---
export const getAdminRaces = (token: string, status: "pending" | "published" | "rejected" = "pending") =>
  apiRequest<RaceDetail[]>(`/admin/races?status=${status}`, { token });

export const createRace = (token: string, race: RaceInput) =>
  apiRequest<RaceDetail>("/admin/races", { method: "POST", body: race, token });

export const updateRace = (token: string, raceId: string, race: RaceInput) =>
  apiRequest<RaceDetail>(`/admin/races/${raceId}`, { method: "PUT", body: race, token });

export const reviewRace = (token: string, raceId: string, decision: "approve" | "reject") =>
  apiRequest<RaceDetail>(`/admin/races/${raceId}/${decision}`, { method: "POST", token });

export const removeRaceMessage = (token: string, messageId: string) =>
  apiRequest<void>(`/admin/race-messages/${messageId}`, { method: "DELETE", token });
