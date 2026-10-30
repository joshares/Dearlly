import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { WriteDate } from "./WriteDate";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push }) }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const SHIRO = {
  key: "shiro", name: "Shiro Lagos", area: "Victoria Island", address: "Water Corporation Road",
  kind: "restaurant", vibes: ["romantic_dinner", "luxury"], price: 3, price_note: "About ₦35,000 a person",
  sources: [
    { publisher: "Discover Lagos", title: "10 Date Night Spots", url: "https://example.com/a", published: null, rank: 1 },
    { publisher: "Marie Claire Nigeria", title: "Guide", url: "https://example.com/b", published: "2026-02-14", rank: null },
  ],
};
const BEACH = { ...SHIRO, key: "tarkwa-bay", name: "Tarkwa Bay", area: "Lagos Harbour", address: null,
  vibes: ["beach"], price: null, price_note: null, sources: [SHIRO.sources[1]] };

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
      if (path === "/cities") return json(200, [{ key: "lagos", name: "Lagos", place_count: 2 }, { key: "abuja", name: "Abuja", place_count: 0 }]);
      if (path === "/cities/lagos/places") return json(200, [SHIRO, BEACH]);
      if (path === "/cities/abuja/places") return json(200, []);
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

function fillIn() {
  fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Tolu" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0]!);
  fireEvent.change(screen.getByLabelText(/Date and time/), { target: { value: "2026-11-07T19:00" } });
}

describe("WriteDate", () => {
  it("picks a curated place by vibe, shows why, and seals with its key", async () => {
    render(<WriteDate loggedIn />);
    fillIn();
    const list = (await screen.findByText("Shiro Lagos")).closest("ul")!;
    expect(within(list).getByText("Featured in 2 guides")).toBeTruthy();
    expect(within(list).getAllByText("#1 on Discover Lagos").length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Beach" }));
    expect(screen.queryByText("Shiro Lagos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Romantic dinner" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose" }));
    // The preview shows where and when.
    expect(screen.getAllByText(/Shiro Lagos/).length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Seal it" }));
    expect(await screen.findByText("Sealed with love.")).toBeTruthy();
    expect(created).toMatchObject({
      type: "date_invite",
      content: {
        message: "Will you go on a date with me?",
        city: "lagos",
        place_key: "shiro",
        place_name: null,
        date_at: "2026-11-07T19:00:00+01:00",
      },
    });
  });

  it("can't be sealed without a place, and a typed-in place works", async () => {
    render(<WriteDate loggedIn />);
    fillIn();
    const seal = screen.getByRole("button", { name: "Seal it" }) as HTMLButtonElement;
    expect(seal.disabled).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Somewhere else" }));
    fireEvent.change(screen.getByLabelText("Place name"), { target: { value: "Mama Put, Yaba" } });
    expect(seal.disabled).toBe(false);
    fireEvent.click(seal);
    expect(await screen.findByText("Sealed with love.")).toBeTruthy();
    expect(created).toMatchObject({ content: { place_key: null, place_name: "Mama Put, Yaba" } });
  });
});
