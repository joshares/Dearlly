import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { GameLibrary } from "./GameLibrary";

const push = vi.fn();
// One router object, like Next.js's own (a new one per render would re-run effects).
const router = { push, replace: push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const levels = (n: number) => ["friendship", "talking", "romantic", "intense"].map((key) => ({ key, questions: n }));
let created: Record<string, unknown> | null;

beforeEach(() => {
  resetApiState();
  push.mockReset();
  created = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/games/formats")
        return json(200, [
          { key: "mix", name: "Mix", blurb: "A bit of everything.", levels: levels(60) },
          { key: "love_language", name: "Love language quiz", blurb: "Discover yours.", levels: levels(10) },
        ]);
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/games") {
        created = JSON.parse(init.body as string);
        return json(201, { code: "ABC234" });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GameLibrary", () => {
  it("creates the chosen game and opens its room", async () => {
    render(<GameLibrary loggedIn />);
    fireEvent.click(await screen.findByLabelText(/Love language quiz/));
    // Only 10 questions: 15 and 20 rounds can't be picked.
    expect((screen.getByLabelText("15") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Friendship/));
    fireEvent.click(screen.getByRole("button", { name: "Create game" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/play/ABC234"));
    expect(created).toEqual({ format: "love_language", intensity: "friendship", rounds: 10 });
  });

  it("asks both to opt in for Intense", async () => {
    render(<GameLibrary loggedIn />);
    fireEvent.click(await screen.findByLabelText(/Intense/));
    const create = screen.getByRole("button", { name: "Create game" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I'm in for Intense/));
    expect(create.disabled).toBe(false);
  });

  it("sends people without an account to log in first", async () => {
    render(<GameLibrary loggedIn={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create game" }));
    expect(push).toHaveBeenCalledWith("/login?next=%2Fgames");
    expect(created).toBeNull();
  });
});
