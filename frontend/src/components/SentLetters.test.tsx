import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { type SentLetter, SentLetters } from "./SentLetters";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const base: SentLetter = {
  id: "1",
  type: "love_note",
  url: "https://dearlly.app/l/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  recipient_name: "Tolu",
  recipient_title: null,
  created_at: "2026-10-29T09:00:00Z",
  opens_at: null,
  first_opened_at: null,
  open_count: 0,
  reply: null,
  revoked: false,
};

let letters: SentLetter[];

beforeEach(() => {
  resetApiState();
  letters = [
    base,
    { ...base, id: "2", recipient_name: "Bisi", first_opened_at: "2026-10-29T19:30:00Z", open_count: 3 },
    {
      ...base,
      id: "3",
      recipient_name: "Kemi",
      first_opened_at: "2026-10-29T19:30:00Z",
      open_count: 1,
      reply: { reaction: "love_it", note: "You too", replied_at: "2026-10-29T20:00:00Z" },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/me/experiences") return json(200, letters);
      if (path === "/experience-types")
        return json(200, [{ key: "love_note", reactions: [{ key: "love_it", label: "I love this" }] }]);
      if (path === "/me/experiences/1/revoke") return json(200, { ...base, url: null, revoked: true });
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows Opened and Replied for each letter", async () => {
  render(<SentLetters />);
  expect(await screen.findByText("Not opened yet")).toBeTruthy();
  expect(screen.getByText(/Opened 29 Oct 2026.*· 3 times/)).toBeTruthy();
  await waitFor(() => expect(screen.getByText("Replied: ❤️ I love this")).toBeTruthy());
  expect(screen.getByText("“You too”")).toBeTruthy();
});

it("takes a letter back only after confirming", async () => {
  render(<SentLetters />);
  const item = (await screen.findByText("To Tolu")).closest("li") as HTMLElement;
  fireEvent.click(within(item).getByRole("button", { name: "Take back" }));
  fireEvent.click(within(item).getByRole("button", { name: "Keep it" }));
  fireEvent.click(within(item).getByRole("button", { name: "Take back" }));
  fireEvent.click(within(item).getByRole("button", { name: "Yes, take it back" }));
  expect(await within(item).findByText(/Taken back/)).toBeTruthy();
  expect(within(item).queryByRole("button", { name: "Copy link" })).toBeNull();
});
