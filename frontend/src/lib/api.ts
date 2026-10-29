/**
 * Talks to the Dearlly API from the browser.
 * - Cookies carry the session (HttpOnly: scripts can't read them).
 * - Every change sends the CSRF token, fetched once from /auth/csrf and kept in memory.
 * - When the 15-minute access pass expires, it renews once via /auth/refresh and retries.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8100";

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

/** Test hook: forget the cached CSRF token. */
export function resetApiState(): void {
  csrfToken = null;
}

async function send(path: string, method: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["X-CSRF-Token"] = await getCsrfToken();
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
  }

  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
