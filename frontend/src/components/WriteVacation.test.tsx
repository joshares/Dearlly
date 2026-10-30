import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";
import { tripDates } from "@/lib/invitation";

import { WriteVacation } from "./WriteVacation";

const push = vi.fn();
// One router object, like Next.js's own (a new one per render would re-run effects).
const router = { push, replace: push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let created: Record<string, unknown> | null;

beforeEach(() => {
  resetApiState();
  push.mockReset();
  window.localStorage.clear();
  created = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/experiences") {
        created = JSON.parse(init.body as string);
        return json(201, { url: "https://dearlly.app/l/abc123abc123abc123abc123abc123ab", opens_at: null, email_status: null });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("tripDates", () => {
  it("reads like a person would write it", () => {
    expect(tripDates("2026-12-12", "2026-12-16")).toBe("12–16 Dec 2026 · 4 nights");
    expect(tripDates("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027 · 3 nights");
    expect(tripDates("2026-11-28", "2026-12-01")).toBe("28 Nov – 1 Dec 2026 · 3 nights");
    expect(tripDates("2026-12-12", "2026-12-13")).toBe("12–13 Dec 2026 · 1 night");
    expect(tripDates("2026-12-12", "2026-12-12")).toBe("12 Dec 2026 · Day trip");
    expect(tripDates("soon", "")).toBe("");
  });
});

describe("WriteVacation", () => {
  it("fills in the trip, keeps the return after the start, and seals it", async () => {
    render(<WriteVacation loggedIn />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Tolu" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0]!);
    fireEvent.change(screen.getByLabelText(/Where to/), { target: { value: "Zanzibar" } });
    fireEvent.change(screen.getByLabelText("Leaving on"), { target: { value: "2026-12-12" } });
    // Coming back moved along with leaving.
    expect((screen.getByLabelText("Coming back on") as HTMLInputElement).value).toBe("2026-12-12");
    fireEvent.change(screen.getByLabelText("Coming back on"), { target: { value: "2026-12-16" } });
    fireEvent.change(screen.getByLabelText(/What to pack/), { target: { value: "Swimsuit" } });
    expect(screen.getAllByText("12–16 Dec 2026 · 4 nights").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Seal it" }));
    expect(await screen.findByText("Sealed with love.")).toBeTruthy();
    expect(created).toMatchObject({
      type: "vacation_invite",
      content: {
        message: "Pack your bags. We're going away, just us.",
        destination: "Zanzibar",
        start_date: "2026-12-12",
        end_date: "2026-12-16",
        packing: "Swimsuit",
        note: null,
      },
    });
  });
});
