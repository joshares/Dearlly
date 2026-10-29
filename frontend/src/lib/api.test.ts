import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_URL, ApiError, api, resetApiState } from "./api";

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Record<string, Response[]>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${url.replace(API_URL, "")}`;
    const queue = responses[key];
    const next = queue?.shift();
    if (!next) throw new Error(`unexpected request ${key}`);
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => resetApiState());
afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends the CSRF token and cookies on changes", async () => {
    const calls = mockFetch({
      "GET /auth/csrf": [json(200, { csrf_token: "tok" })],
      "POST /auth/start": [json(202, { status: "code_sent" })],
    });
    await api("/auth/start", { method: "POST", body: { email: "a@b.c" } });
    const post = calls[1]!;
    expect((post.init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
    expect(post.init.credentials).toBe("include");
  });

  it("renews an expired session once, then retries", async () => {
    mockFetch({
      "GET /me": [json(401, { detail: "Please log in." }), json(200, { username: "ada_demo" })],
      "GET /auth/csrf": [json(200, { csrf_token: "tok" })],
      "POST /auth/refresh": [new Response(null, { status: 204 })],
    });
    await expect(api<{ username: string }>("/me")).resolves.toEqual({ username: "ada_demo" });
  });

  it("gives up with a 401 when the session can't be renewed", async () => {
    mockFetch({
      "GET /me": [json(401, { detail: "Please log in." })],
      "GET /auth/csrf": [json(200, { csrf_token: "tok" })],
      "POST /auth/refresh": [json(401, { detail: "Please log in." })],
    });
    const error = await api("/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  it("explains rate limits in plain words", async () => {
    mockFetch({
      "GET /auth/csrf": [json(200, { csrf_token: "tok" })],
      "POST /auth/start": [json(429, { detail: "x" })],
    });
    const error = (await api("/auth/start", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.detail).toMatch(/Too many attempts/);
  });
});
