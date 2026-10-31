import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";
import type { GameView } from "@/lib/game-socket";

import { GameRoom, resultCard } from "./GameRoom";

const replace = vi.fn();
// One router object, like Next.js's own (a new one per render would re-run effects).
const router = { push: replace, replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stands in for the browser's WebSocket: records what the page sends; tests play the server. */
class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  serve(message: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
  drop(code: number) {
    act(() => this.onclose?.({ code }));
  }
}

const ADA = "a", TOLU = "t";
const INFO = { code: "ABC234", format: "same_page", format_name: "Same page", intensity: "romantic", rounds: 3, status: "lobby", host_name: "Ada", you: "host", full: true };

function view(over: Partial<GameView> = {}): GameView {
  return {
    version: 1, status: "lobby", format: "same_page", intensity: "romantic", total: 3, host: ADA, me: ADA,
    players: [
      { id: ADA, name: "Ada", ready: false, online: true, skips_left: 0 },
      { id: TOLU, name: "Tolu", ready: false, online: true, skips_left: 0 },
    ],
    round: null, summary: null, ...over,
  };
}

const ROUND = {
  number: 1, format: "same_page", format_name: "Same page", answer: "choice" as const, text: "Tea or coffee?",
  options: ["Tea", "Coffee"], subject: null, choice: null, can_answer: true, answered: [], my_answer: null,
  my_choice: null, my_rating: null, revealed: false, answers: null, match: null, seconds_left: null,
};

let info: Record<string, unknown>;
let refreshOk: boolean;

beforeEach(() => {
  resetApiState();
  replace.mockReset();
  FakeSocket.all = [];
  info = { ...INFO };
  refreshOk = true;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/auth/refresh") return refreshOk ? json(200, {}) : json(401, { detail: "Please log in." });
      if (path === "/games/ABC234") return json(200, info);
      if (path === "/games/ABC234/join") return json(200, { ...info, you: "guest" });
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function connected() {
  render(<GameRoom code="ABC234" />);
  await waitFor(() => expect(FakeSocket.all.length).toBe(1));
  const ws = FakeSocket.all[0]!;
  expect(ws.url).toBe("ws://localhost:8100/games/ABC234/live");
  return ws;
}

describe("GameRoom", () => {
  it("joins as a guest after confirming Intense", async () => {
    info = { ...INFO, you: "visitor", full: false, intensity: "intense" };
    render(<GameRoom code="ABC234" />);
    expect(await screen.findByText("Ada invited you to play")).toBeTruthy();
    const join = screen.getByRole("button", { name: "Join the game" }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I'm in for Intense/));
    fireEvent.click(join);
    await waitFor(() => expect(FakeSocket.all.length).toBe(1));
  });

  it("sends a logged-out player to log in and back", async () => {
    vi.mocked(fetch).mockImplementation(async () => json(401, { detail: "Please log in." }));
    render(<GameRoom code="ABC234" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fplay%2FABC234"));
  });

  it("lobby: invite while alone, then both ready", async () => {
    const ws = await connected();
    ws.serve({ t: "state", state: view({ players: [view().players[0]!] }) });
    expect(screen.getByText("ABC234")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href")).toContain(
      encodeURIComponent("/play/ABC234"),
    );
    ws.serve({ t: "state", state: view() });
    fireEvent.click(screen.getByRole("button", { name: "I'm ready" }));
    expect(ws.sent).toContainEqual({ t: "ready" });
  });

  it("plays a round: private answer, partner's tick, reveal together, host moves on", async () => {
    const ws = await connected();
    ws.serve({ t: "state", state: view({ status: "playing", round: ROUND }) });
    expect(screen.getByRole("heading", { name: "Tea or coffee?" })).toBeTruthy();
    expect(screen.getByText("Tolu is thinking…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    expect(ws.sent).toContainEqual({ t: "answer", value: 1 });
    ws.serve({ t: "state", state: view({ status: "playing", round: { ...ROUND, can_answer: false, my_choice: 1, my_answer: "Coffee", answered: [ADA, TOLU].slice(0, 1) } }) });
    expect(screen.getByText(/Locked in/)).toBeTruthy();
    ws.serve({
      t: "state",
      state: view({ status: "playing", round: { ...ROUND, can_answer: false, my_choice: 1, revealed: true, answers: { [ADA]: "Coffee", [TOLU]: "Coffee" }, match: true } }),
    });
    expect(screen.getByText("It's a match! 💞")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Good question" }));
    expect(ws.sent).toContainEqual({ t: "rate", value: "up" });
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(ws.sent).toContainEqual({ t: "next" });
  });

  it("only the host gets the next button", async () => {
    info = { ...INFO, you: "guest" };
    const ws = await connected();
    ws.serve({ t: "state", state: view({ me: TOLU, status: "playing", round: { ...ROUND, revealed: true, answers: { [ADA]: "Tea", [TOLU]: "Coffee" }, match: false } }) });
    expect(screen.getByText("Different answers")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next question" })).toBeNull();
    expect(screen.getByText("Ada moves the game on.")).toBeTruthy();
  });

  it("chats both ways", async () => {
    const ws = await connected();
    ws.serve({ t: "state", state: view() });
    ws.serve({ t: "chat_history", messages: [] });
    fireEvent.change(screen.getByLabelText("Message…"), { target: { value: "hi love" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Send" }).at(-1)!);
    expect(ws.sent).toContainEqual({ t: "chat", text: "hi love" });
    ws.serve({ t: "chat", id: "1", from: TOLU, name: "Tolu", text: "hey you", at: "2026-10-31T10:00:00Z" });
    expect(screen.getByText("hey you")).toBeTruthy();
  });

  it("keeps the connection alive while nobody moves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const ws = await connected();
      await vi.advanceTimersByTimeAsync(61_000);
      expect(ws.sent.filter((m) => m.t === "ping").length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews the login and reconnects when the pass expired", async () => {
    const ws = await connected();
    ws.drop(4401);
    await waitFor(() => expect(FakeSocket.all.length).toBe(2));
  });

  it("shows the results", async () => {
    const ws = await connected();
    ws.serve({
      t: "state",
      state: view({ status: "ended", summary: { rounds: 3, matched: 2, scored: 3, guesses: {}, love_languages: { [ADA]: "Quality time", [TOLU]: "Physical touch" } } }),
    });
    expect(screen.getByText("You matched 2 of 3")).toBeTruthy();
    expect(screen.getByText("Your love language: Quality time")).toBeTruthy();
    expect(screen.getByText("Tolu's love language: Physical touch")).toBeTruthy();
  });

  it("offers a skip in games that have them", async () => {
    const ws = await connected();
    const players = view().players.map((p) => ({ ...p, skips_left: p.id === ADA ? 2 : 0 }));
    ws.serve({
      t: "state",
      state: view({ status: "playing", players, round: { ...ROUND, format: "get_to_know", format_name: "Get to know you", answer: "text", options: [], text: "What do you do for fun?" } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Skip (2 left)" }));
    expect(ws.sent).toContainEqual({ t: "skip" });
    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "Dancing" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Send" })[0]!);
    expect(ws.sent).toContainEqual({ t: "answer", value: "Dancing" });
  });

  it("words the shareable card for each kind of result", () => {
    const info = { ...INFO, intensity: "romantic" as const, status: "ended" as const, you: "host" as const };
    const ended = (summary: Partial<GameView["summary"] & object>) =>
      view({ status: "ended", summary: { rounds: 10, matched: 0, scored: 0, guesses: {}, love_languages: {}, ...summary } });
    const matched = resultCard(info, ended({ matched: 7, scored: 10 }));
    expect(matched).toMatchObject({ game: "Same page", level: "Romantic", names: ["Ada", "Tolu"], headline: "7 of 10 matched" });
    const love = resultCard(info, ended({ love_languages: { [ADA]: "Quality time", [TOLU]: "Physical touch" } }));
    expect(love?.headline).toBe("Our love languages");
    expect(love?.lines).toEqual(["Ada: Quality time", "Tolu: Physical touch"]);
    const guess = resultCard(info, ended({ guesses: { [ADA]: 2, [TOLU]: 4 } }));
    expect(guess?.lines).toEqual(["Ada guessed 2 right", "Tolu guessed 4 right"]);
    expect(resultCard(info, ended({}))?.headline).toBe("10 questions, answered together");
  });

  it("offers to share or save the result", async () => {
    const ws = await connected();
    ws.serve({ t: "state", state: view({ status: "ended", summary: { rounds: 3, matched: 2, scored: 3, guesses: {}, love_languages: {} } }) });
    expect(screen.getByRole("button", { name: "Share our result" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save as picture" })).toBeTruthy();
  });
});

