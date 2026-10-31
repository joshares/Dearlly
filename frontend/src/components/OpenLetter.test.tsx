import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { type Letter, OpenLetter } from "./OpenLetter";

const TOKEN = "a".repeat(32); // a fake link token

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const DATE: Partial<Letter> = {
  type: "date_invite",
  content: {
    message: "Dinner with me, Saturday?",
    city: "lagos",
    place_key: "shiro",
    place_name: "Shiro Lagos",
    place_area: "Victoria Island",
    place_address: "Water Corporation Road",
    date_at: "2026-11-07T19:00:00+01:00",
    note: "Wear the blue dress.",
  },
  reply_kind: "yes_no",
  reactions: [
    { key: "yes", label: "Yes!" },
    { key: "no", label: "Not this time" },
  ],
};

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
  reply_kind: "reaction",
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

  it("shows a date invitation with where and when, and they say yes", async () => {
    letter = { ...READY, ...DATE };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    expect(await screen.findByText("Dinner with me, Saturday?")).toBeTruthy();
    expect(screen.getByText(/Shiro Lagos/)).toBeTruthy();
    expect(screen.getByText(/7 Nov 2026/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Yes!/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send my answer" }));
    expect(await screen.findByText("You said yes! 🎉")).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith("/reply"))?.body).toEqual({ reaction: "yes", note: null });
    const directions = screen.getByRole("link", { name: "Get directions" }).getAttribute("href") ?? "";
    expect(decodeURIComponent(directions)).toContain("Shiro Lagos, Water Corporation Road, Victoria Island, Lagos");
    expect(screen.getByRole("link", { name: "Send your own invitation" }).getAttribute("href")).toBe("/write/date");
  });

  it("No runs away a few times, then can always be said", async () => {
    letter = { ...READY, ...DATE };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    const no = await screen.findByRole("radio", { name: "Not this time" });
    // Animations on for this part, so No can dodge.
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    for (const line of ["Are you sure?", "Think about it…", "Okay, okay. You can say no."]) {
      fireEvent.pointerDown(no, { pointerType: "touch" });
      fireEvent.click(no);
      expect(no.getAttribute("aria-checked")).toBe("false");
      expect(screen.getByText(line)).toBeTruthy();
    }
    fireEvent.pointerDown(no, { pointerType: "touch" });
    fireEvent.click(no);
    expect(no.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Send my answer" }));
    expect(await screen.findByText("Answer sent.")).toBeTruthy();
  });

  it("with reduced motion, No never moves", async () => {
    letter = { ...READY, ...DATE };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    const no = await screen.findByRole("radio", { name: "Not this time" });
    fireEvent.pointerDown(no, { pointerType: "touch" });
    fireEvent.click(no);
    expect(no.getAttribute("aria-checked")).toBe("true");
  });

  it("shows a vacation invitation, and they say Let's go", async () => {
    letter = {
      ...READY,
      type: "vacation_invite",
      reply_kind: "yes_no",
      content: {
        message: "Pack your bags.",
        destination: "Zanzibar",
        start_date: "2026-12-12",
        end_date: "2026-12-16",
        packing: "Swimsuit",
      },
      reactions: [
        { key: "yes", label: "Let's go!" },
        { key: "no", label: "Not this time" },
      ],
    };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    expect(await screen.findByText("Let's get away")).toBeTruthy();
    expect(screen.getByText("Zanzibar")).toBeTruthy();
    expect(screen.getByText("12–16 Dec 2026 · 4 nights")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Let's go!/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send my answer" }));
    expect(await screen.findByText("You said yes! 🎉")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Get directions" })).toBeNull();
    expect(screen.getByRole("link", { name: "Plan your own trip invitation" }).getAttribute("href")).toBe("/write/vacation");
  });

  it("keeps the gift under the stamp until it's revealed, then asks for a reply", async () => {
    // jsdom can't draw, so the plain stamp with "Reveal it" shows (as on phones that can't).
    vi.stubGlobal("HTMLCanvasElement", class { getContext() { return null; } });
    letter = {
      ...READY,
      type: "gift_reveal",
      content: { message: "For being you.", gift: "A spa day for two", hint: "Something relaxing" },
      reactions: [
        { key: "love_it", label: "I love it!" },
        { key: "thank_you", label: "Thank you!" },
      ],
    };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    expect(await screen.findByText("For being you.")).toBeTruthy();
    expect(screen.getByText("Something relaxing")).toBeTruthy();
    // Not readable yet, and no reply or download until it's revealed.
    expect(screen.getByText("A spa day for two").closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText(/Scratch the stamp to see your gift/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Seal my reply" })).toBeNull();
    expect(screen.queryByText("Save as picture")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reveal it" }));
    expect(await screen.findByText("Surprise!")).toBeTruthy();
    expect(screen.getByText("A spa day for two").closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("false");
    fireEvent.click(screen.getByLabelText(/Thank you!/));
    fireEvent.click(screen.getByRole("button", { name: "Seal my reply" }));
    expect(await screen.findByText("Reply sealed.")).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith("/reply"))?.body).toEqual({ reaction: "thank_you", note: null });
    expect(screen.getByRole("link", { name: "Send your own gift reveal" }).getAttribute("href")).toBe("/write/gift");
  });

  it("hides a gift's photo under the stamp until it's revealed", async () => {
    vi.stubGlobal("HTMLCanvasElement", class { getContext() { return null; } });
    letter = {
      ...READY,
      type: "gift_reveal",
      content: { message: "For you.", gift: "New shoes" },
      photo: { url: "http://localhost:8100/photos/p.jpg?e=1&s=x", small_url: "http://localhost:8100/photos/p.jpg?e=1&s=x&size=small", width: 1200, height: 900 },
    };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    const pic = await screen.findByAltText("A photo of your gift");
    // Not on the letter itself, and under the (closed) stamp.
    expect(screen.queryByAltText(/A photo from/)).toBeNull();
    expect(pic.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
    expect(pic.parentElement?.style.aspectRatio).toMatch(/^1\.333/); // 1200×900 keeps 4:3
    fireEvent.click(screen.getByRole("button", { name: "Reveal it" }));
    expect(await screen.findByText("Surprise!")).toBeTruthy();
    expect(pic.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("false");
  });

  it("shows a love note's photo, the phone copy first, with its space kept", async () => {
    letter = {
      ...READY,
      photo: { url: "http://localhost:8100/photos/p.jpg?e=1&s=x", small_url: "http://localhost:8100/photos/p.jpg?e=1&s=x&size=small", width: 1600, height: 1066 },
    };
    render(<OpenLetter token={TOKEN} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break the seal" }));
    const pic = await screen.findByAltText("A photo from Ada");
    expect(pic.getAttribute("src")).toContain("size=small");
    expect(pic.getAttribute("srcset")).toContain("1600w");
    expect([pic.getAttribute("width"), pic.getAttribute("height")]).toEqual(["1600", "1066"]);
  });

  it("lets the recipient block a secret admirer with one tap", async () => {
    letter = { ...READY, sender_name: "A secret admirer", secret: true };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push({ path, method: init?.method ?? "GET" });
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path.endsWith("/block")) return new Response(null, { status: 204 });
      if (path.endsWith("/open")) return new Response(null, { status: 204 });
      return json(200, letter);
    });
    render(<OpenLetter token={TOKEN} />);
    expect(await screen.findByRole("button", { name: /from A secret admirer/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Break the seal" }));
    expect(await screen.findByText("Let your secret admirer know how this made you feel.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Block this secret admirer" }));
    expect(await screen.findByText("Blocked.")).toBeTruthy();
    expect(calls.some((c) => c.path === `/letters/${TOKEN}/block` && c.method === "POST")).toBe(true);
  });

  it("has no block button on letters with a name", async () => {
    render(<OpenLetter token={TOKEN} />);
    await screen.findByRole("button", { name: "Break the seal" });
    expect(screen.queryByRole("button", { name: "Block this secret admirer" })).toBeNull();
  });
});

