// Central API client. Every screen should go through here rather than
// calling fetch() directly, so auth headers / base URL / error handling
// live in one place.

import { Platform } from "react-native";
import type { ReportReason } from "./options";
import type {
  DatingPreferences,
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
  if (Platform.OS === "web") {
    // On web the picker gives a blob:/data: URI; send the actual bytes
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, "photo.jpg");
  } else {
    // React Native's FormData accepts a file descriptor object instead of a Blob
    form.append("file", { uri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
  }

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

export const getDiscoverFeed = (token: string) =>
  apiRequest<DiscoverCard[]>("/discover", { token });

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
  report: { reportedUserId: string; matchId?: string; reason: ReportReason; details?: string }
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
