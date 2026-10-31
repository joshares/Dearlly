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

const replace = vi.fn();
// One router object, like Next.js's own: a new one per render would re-run the page's effects.
const router = { push: replace, replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
      if (path === "/me/experiences") {
        const query = new URL(url).searchParams;
        const page = Number(query.get("page")), perPage = Number(query.get("per_page"));
        const items = letters.slice((page - 1) * perPage, page * perPage);
        return json(200, { items, total: letters.length, page, per_page: perPage });
      }
      if (path === "/experience-types")
        return json(200, [{ key: "love_note", reactions: [{ key: "love_it", label: "I love this" }] }]);
      if (path === "/me/experiences/1/revoke") {
        // Like the server: once taken back, every later list shows it taken back.
        letters = letters.map((l) => (l.id === "1" ? { ...l, url: null, revoked: true } : l));
        return json(200, { ...base, url: null, revoked: true });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows Opened and Replied for each letter", async () => {
  render(<SentLetters perPage={10} />);
  expect(await screen.findByText("Not opened yet")).toBeTruthy();
  expect(screen.getByText(/Opened 29 Oct 2026.*· 3 times/)).toBeTruthy();
  await waitFor(() => expect(screen.getByText("Replied: ❤️ I love this")).toBeTruthy());
  // Opened still shows once there's a reply.
  const kemi = screen.getByText("To Kemi").closest("li") as HTMLElement;
  expect(within(kemi).getByText(/^Opened 29 Oct 2026/)).toBeTruthy();
  expect(screen.getByText("“You too”")).toBeTruthy();
});

it("takes a letter back only after confirming", async () => {
  render(<SentLetters perPage={10} />);
  const item = (await screen.findByText("To Tolu")).closest("li") as HTMLElement;
  fireEvent.click(within(item).getByRole("button", { name: "Take back" }));
  fireEvent.click(within(item).getByRole("button", { name: "Keep it" }));
  fireEvent.click(within(item).getByRole("button", { name: "Take back" }));
  fireEvent.click(within(item).getByRole("button", { name: "Yes, take it back" }));
  expect(await within(item).findByText(/Taken back/)).toBeTruthy();
  expect(within(item).queryByRole("button", { name: "Copy link" })).toBeNull();
});

it("shows the latest few on the profile with a link to all of them", async () => {
  letters = Array.from({ length: 5 }, (_, i) => ({ ...base, id: String(i), recipient_name: `R${i}` }));
  render(<SentLetters perPage={3} />);
  expect(await screen.findByText("To R2")).toBeTruthy();
  expect(screen.queryByText("To R3")).toBeNull();
  expect(screen.getByRole("link", { name: "See all your letters (5)" }).getAttribute("href")).toBe("/letters");
});

it("pages through every letter on the letters page", async () => {
  letters = Array.from({ length: 12 }, (_, i) => ({ ...base, id: String(i), recipient_name: `R${i}` }));
  render(<SentLetters perPage={10} page={2} paged />);
  expect(await screen.findByText("To R10")).toBeTruthy();
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  expect(screen.getByRole("link", { name: "← Newer" }).getAttribute("href")).toBe("/letters?page=1");
  expect(screen.queryByRole("link", { name: "Older →" })).toBeNull();
  expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
});

it("shows where and when for a date invitation, and their Yes", async () => {
  letters = [
    {
      ...base,
      type: "date_invite",
      content: { place_name: "Shiro Lagos", date_at: "2026-11-07T19:00:00+01:00" },
      first_opened_at: "2026-10-30T10:00:00Z",
      open_count: 1,
      reply: { reaction: "yes", note: null, replied_at: "2026-10-30T10:01:00Z" },
    },
  ];
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/experience-types")
      return json(200, [{ key: "date_invite", reactions: [{ key: "yes", label: "Yes!" }] }]);
    return json(200, { items: letters, total: 1, page: 1, per_page: 10 });
  });
  render(<SentLetters perPage={10} />);
  expect(await screen.findByText(/Shiro Lagos · 7 Nov 2026/)).toBeTruthy();
  await waitFor(() => expect(screen.getByText("Replied: 🎉 Yes!")).toBeTruthy());
});

it("lets a secret admirer reveal their name, after confirming", async () => {
  letters = [{ ...base, secret: true, revealed: false, blocked: false }];
  vi.mocked(fetch).mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
    if (path === "/experience-types") return json(200, []);
    if (path === "/me/experiences/1/reveal") return json(200, { ...letters[0], revealed: true });
    return json(200, { items: letters, total: 1, page: 1, per_page: 10 });
  });
  render(<SentLetters perPage={10} />);
  expect(await screen.findByText("Secret admirer · your name is hidden")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reveal my name" }));
  fireEvent.click(screen.getByRole("button", { name: "Yes, reveal it" }));
  expect(await screen.findByText("Secret admirer · you revealed your name")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reveal my name" })).toBeNull();
});

it("tells the sender when a secret letter was blocked", async () => {
  letters = [{ ...base, url: null, secret: true, blocked: true }];
  render(<SentLetters perPage={10} />);
  expect(await screen.findByText("They blocked this secret admirer letter")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reveal my name" })).toBeNull();
});
