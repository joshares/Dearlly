/**
 * Talks to the Dearlly API from the browser.
 * - Cookies carry the session (HttpOnly: scripts can't read them).
 * - Every change sends the CSRF token, fetched once from /auth/csrf and kept in memory.
 * - When the 15-minute access pass expires, it renews once via /auth/refresh and retries.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8100";

/** Set by the API next to the login cookies; holds only "1" (see backend app/api/deps.py). */
export const LOGIN_HINT = "dl_in";

export type MyProfile = {
  id: string;
  username: string;
  display_name: string | null;
  email: string;
  plan: "free" | "premium";
  has_password: boolean;
  created_at: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/auth/csrf`, { credentials: "include" });
    csrfToken = ((await response.json()) as { csrf_token: string }).csrf_token;
  }
  return csrfToken;
}

/**
 * Answers already fetched in this tab (your profile, your letters), so moving between pages
 * shows them at once while a fresh copy loads quietly. Cleared on log in and log out.
 */
const remembered = new Map<string, unknown>();

export function peek<T>(path: string): T | undefined {
  return remembered.get(path) as T | undefined;
}

export function remember(path: string, value: unknown): void {
  remembered.set(path, value);
}

/** After logging in as someone (maybe someone else): nothing remembered may carry over. */
export function forgetRemembered(): void {
  remembered.clear();
}

/** Forget everything about the current login in this tab, including the "logged in" hint. */
export function forgetLogin(): void {
  remembered.clear();
  if (typeof document !== "undefined") {
    // The server clears it too; this covers the case where its reply never arrived.
    const host = window.location.hostname;
    document.cookie = `${LOGIN_HINT}=; Max-Age=0; Path=/`;
    document.cookie = `${LOGIN_HINT}=; Max-Age=0; Path=/; Domain=${host}`;
  }
}

/** Test hook: forget the cached CSRF token and remembered answers. */
export function resetApiState(): void {
  csrfToken = null;
  remembered.clear();
}

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }
  // A file (photo uploads) is sent as itself; everything else as JSON.
  const file = typeof Blob !== "undefined" && body instanceof Blob ? body : null;
  if (body !== undefined) {
    headers["Content-Type"] = file ? file.type : "application/json";
  }
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : (file ?? JSON.stringify(body)),
    credentials: "include",
  });
}

async function errorFrom(response: Response): Promise<ApiError> {
  let detail = "Something went wrong. Please try again.";
  try {
    const data = (await response.json()) as { detail?: unknown };
    if (typeof data.detail === "string") detail = data.detail;
  } catch {
    // Not JSON: keep the generic message.
  }
  if (response.status === 429) detail = "Too many attempts. Please wait a little and try again.";
  return new ApiError(response.status, detail);
}

export async function api<T>(
  path: string,
  { method = "GET", body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response = await send(path, method, body);

  // The CSRF cookie can expire or be replaced: fetch a fresh token and retry once.
  if (response.status === 403 && method !== "GET") {
    csrfToken = null;
    response = await send(path, method, body);
  }
  // Expired access pass: renew once, then retry.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    const refreshed = await send("/auth/refresh", "POST", undefined);
    if (refreshed.ok) response = await send(path, method, body);
    else forgetLogin();
  }

  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
