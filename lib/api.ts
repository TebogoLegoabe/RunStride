// Central API client. Every screen should go through here rather than
// calling fetch() directly, so auth headers / base URL / error handling
// live in one place.

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`API ${method} ${path} failed: ${message}`);
  }

  return res.json() as Promise<T>;
}

// --- Auth ---
export const sendOtp = (phone: string) =>
  apiRequest<{ sent: boolean }>("/auth/otp/send", { method: "POST", body: { phone } });

export const verifyOtp = (phone: string, code: string) =>
  apiRequest<{ token: string; userId: string }>("/auth/otp/verify", {
    method: "POST",
    body: { phone, code },
  });

// --- Verification ---
export const startIdVerification = (token: string) =>
  apiRequest<{ verificationUrl: string }>("/verification/start", {
    method: "POST",
    token,
  });

// --- Matching ---
export const getDiscoverFeed = (token: string) =>
  apiRequest<import("./types").Profile[]>("/matches/discover", { token });
