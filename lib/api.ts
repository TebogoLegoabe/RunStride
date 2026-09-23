// Central API client. Every screen should go through here rather than
// calling fetch() directly, so auth headers / base URL / error handling
// live in one place.

import { Platform } from "react-native";
import type { MyProfile, Photo, VerificationState } from "./types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

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

// Resolves to null if the user hasn't created a profile yet
export const getMyProfile = (token: string) =>
  apiRequest<MyProfile>("/me/profile", { token }).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });

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

// --- Matching ---
export const getDiscoverFeed = (token: string) =>
  apiRequest<import("./types").Profile[]>("/matches/discover", { token });
