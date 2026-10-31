import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { AdminPanel } from "./AdminPanel";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let admin: boolean;
let calls: { path: string; method: string; body?: unknown }[];
const QUESTION = { key: "sp_weekend", game: "Same page", text: "The perfect Saturday starts with…", options: ["A lie-in", "Breakfast"], levels: ["romantic"], depth: 1, shown: 12, skipped: 5, thumbs_up: 1, thumbs_down: 4, retired: false, weakness: 1.0 };
const REPORT = {
  id: "r1", reason: "scam", note: "Asked for money", created_at: "2026-10-31T10:00:00Z", status: "open", resolution: null,
  sender: "@ada_demo", sender_reports: 2,
  letter: { id: "l1", type: "love_note", sender_name: "Ada", recipient_name: "Tolu", secret_admirer: false, content: { quote_text: "Send me ₦50,000" }, photo: null, created_at: "2026-10-31T09:00:00Z", taken_down: false },
};

beforeEach(() => {
  resetApiState();
  admin = true;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const method = init.method ?? "GET";
      calls.push({ path: u.pathname, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (u.pathname === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (u.pathname === "/me") return json(200, { username: "founder_demo", is_admin: admin });
      if (u.pathname === "/admin/overview")
        return json(200, {
          users: { total: 120, last_7_days: 30, last_24_hours: 4 },
          letters: { total: 80, last_7_days: 20, by_type: { love_note: 60, date_invite: 20 }, opened: 60, replied: 40, emailed: 10, secret_admirer: 5, taken_back: 2 },
          games: { total: 15, finished: 9, playing_now: 1, last_7_days: 6 }, photos: 12, open_reports: 1,
        });
      if (u.pathname === "/admin/reports") return json(200, u.searchParams.get("show") === "resolved" ? [] : [REPORT]);
      if (u.pathname.startsWith("/admin/reports/")) return new Response(null, { status: 204 });
      if (u.pathname === "/admin/questions") return json(200, { items: [QUESTION], total: 1, page: 1, pages: 1 });
      if (u.pathname.startsWith("/admin/questions/")) return new Response(null, { status: 204 });
      if (u.pathname === "/games/formats") return json(200, [{ key: "mix", name: "Mix" }, { key: "same_page", name: "Same page" }]);
      throw new Error(`unexpected ${u.pathname}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminPanel", () => {
  it("shows nothing to people who aren't admins", async () => {
    admin = false;
    render(<AdminPanel />);
    expect(await screen.findByText("Page not found.")).toBeTruthy();
    expect(calls.some((c) => c.path.startsWith("/admin"))).toBe(false);
  });

  it("shows how Dearlly is doing", async () => {
    render(<AdminPanel />);
    expect(await screen.findByText("120")).toBeTruthy();
    expect(screen.getByText(/75% opened · 50% replied/)).toBeTruthy();
    expect(screen.getByText("Date invitations")).toBeTruthy();
  });

  it("takes down a reported letter after confirming", async () => {
    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Reports" }));
    expect(await screen.findByText("Scam or asking for money")).toBeTruthy();
    expect(screen.getByText(/Send me ₦50,000/)).toBeTruthy();
    expect(screen.getByText(/2 reports against this sender/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take it down" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/admin/reports/r1/takedown" && c.method === "POST")).toBe(true));
  });

  it("retires a weak question", async () => {
    render(<AdminPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Questions" }));
    expect(await screen.findByText("The perfect Saturday starts with…")).toBeTruthy();
    expect(screen.getByText(/12 played · 5 skipped · 👍 1 · 👎 4/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(calls.find((c) => c.path === "/admin/questions/sp_weekend/retired")?.body).toEqual({ retired: true }));
  });
});
