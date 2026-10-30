import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { type Letter, OpenLetter } from "./OpenLetter";

const TOKEN = "a".repeat(32); // a fake link token

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const READY: Letter = {
  status: "ready",
  type: "love_note",
  sender_name: "Ada",
  recipient_name: "Tolu",
  recipient_title: "my love",
  theme: "rose",
  opens_at: null,
  opens_in_seconds: 0,
  content: { quote_title: "Na you", quote_text: "Na you my heart choose." },
  reactions: [
    { key: "love_it", label: "I love this" },
    { key: "aww", label: "Aww" },
  ],
  reply: null,
  is_sender: false,
};

let letter: Letter | null;
let calls: { path: string; method: string; body?: unknown }[];

beforeEach(() => {
  resetApiState();
  letter = { ...READY };
  calls = [];
  // Reduced motion: the seal opens at once, so tests don't wait for the animation.
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const method = init.method ?? "GET";
      calls.push({ path, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/auth/refresh") return json(401, { detail: "Please log in." });
      if (!letter) return json(404, { detail: "This letter doesn't exist or was taken back by the sender." });
      if (path === `/letters/${TOKEN}`) return json(200, letter);
      if (path === `/letters/${TOKEN}/open`) return new Response(null, { status: 204 });
      if (path === `/letters/${TOKEN}/reply`) {
        const body = JSON.parse(init.body as string);
        return json(200, { ...body, replied_at: "2026-10-30T10:00:00Z" });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OpenLetter", () => {
  it("stays sealed until the seal is broken, and only then counts as Opened", async () => {
    render(<OpenLetter token={TOKEN} />);
    await screen.findByRole("button", { name: "Break the seal" });
    expect(screen.queryByText("Na you my heart choose.")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/open"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Break the seal" }));
    expect(await screen.findByText("Na you my heart choose.")).toBeTruthy();
    expect(screen.getByText("Dear my love,")).toBeTruthy();
    await waitFor(() =>
      expect(calls.some((c) => c.path === `/letters/${TOKEN}/open` && c.method === "POST")).toBe(true),
    );
  });

  it("seals a reply with a reaction and a note", async () => {
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Seal my reply" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Pick one first.");

    fireEvent.click(screen.getByLabelText(/I love this/));
    fireEvent.change(screen.getByLabelText(/Add a short note/), { target: { value: "  Forever  " } });
    fireEvent.click(screen.getByRole("button", { name: "Seal my reply" }));
    expect(await screen.findByText("Reply sealed.")).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith("/reply"))?.body).toEqual({ reaction: "love_it", note: "Forever" });
    expect(screen.getByRole("link", { name: "Write your own love note" }).getAttribute("href")).toBe("/write");
  });

  it("shows a countdown while the letter is sealed until later", async () => {
    letter = {
      ...READY,
      status: "sealed_until",
      content: null,
      opens_at: new Date(Date.now() + 2 * 86400_000 + 3600_000 + 30_000).toISOString(),
      opens_in_seconds: 2 * 86400 + 3600 + 30,
    };
    render(<OpenLetter token={TOKEN} />);
    expect(await screen.findByText("Not yet…")).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toMatch(/^02d01h/);
    expect(screen.queryByRole("button", { name: "Break the seal" })).toBeNull();
  });

  it("opens by itself when the countdown ends, even if the server is a moment behind", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sealed: Letter = { ...READY, status: "sealed_until", content: null, opens_in_seconds: 2,
      opens_at: new Date(Date.now() + 2000).toISOString() };
    let asks = 0;
    // The first two answers still say "sealed" (a phone clock running ahead), then it opens.
    vi.mocked(fetch).mockImplementation(async () => {
      asks += 1;
      return json(200, asks <= 2 ? { ...sealed, opens_in_seconds: 1 } : READY);
    });
    try {
      render(<OpenLetter token={TOKEN} />);
      expect(await screen.findByText("Not yet…")).toBeTruthy();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await screen.findByRole("button", { name: "Break the seal" })).toBeTruthy();
      expect(asks).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the sender a preview doesn't count, with no reply form", async () => {
    letter = { ...READY, is_sender: true };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    expect(await screen.findByText(/doesn't count as Opened/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Seal my reply" })).toBeNull();
  });

  it("explains a missing or taken-back letter", async () => {
    letter = null;
    render(<OpenLetter token={TOKEN} />);
    expect(await screen.findByText("No letter here")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/taken back by the sender/);
  });
});
