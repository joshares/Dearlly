import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages, locales } from "@/i18n";

import { Home } from "./page";

beforeEach(() => {
  // Visitor is not logged in.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ detail: "Please log in." }), { status: 401 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("home page", () => {
  it("shows the headline from the translation file", () => {
    render(<Home loggedIn={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(getMessages().home.title);
  });

  it("has phone navigation with Home as the current page", () => {
    render(<Home loggedIn={false} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const home = nav.querySelector('[aria-current="page"]');
    expect(home?.textContent).toContain("Home");
    expect(home?.getAttribute("href")).toBe("/");
  });

  it("links only to pages that exist", () => {
    render(<Home loggedIn={false} />);
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(new Set(hrefs)).toEqual(new Set(["/", "/login", "/privacy", "/profile", "/write", "/write/date"]));
  });

  it("offers sign-up as the main action", () => {
    render(<Home loggedIn={false} />);
    const cta = screen.getByRole("link", { name: getMessages().home.primaryCta });
    expect(cta.getAttribute("href")).toBe("/login");
  });
});

describe("letter cards", () => {
  it("open the forms that work, and say 'opening soon' on the rest", () => {
    render(<Home loggedIn={false} />);
    const home = getMessages().home;
    expect(screen.getByRole("link", { name: new RegExp(home.experiences.loveNote.title) }).getAttribute("href")).toBe("/write");
    expect(screen.getByRole("link", { name: new RegExp(home.experiences.date.title) }).getAttribute("href")).toBe("/write/date");
    expect(screen.queryByRole("link", { name: new RegExp(home.experiences.gift.title) })).toBeNull();
    expect(screen.getAllByText(home.soon)).toHaveLength(2);
  });
});

describe("home page when logged in", () => {
  it("drops 'Create your account' and offers a love note or a date", () => {
    render(<Home loggedIn />);
    const home = getMessages().home;
    expect(screen.queryByRole("link", { name: home.primaryCta })).toBeNull();
    expect(screen.getByRole("link", { name: home.secondaryCta }).getAttribute("href")).toBe("/write");
    expect(screen.getByRole("link", { name: home.dateCta }).getAttribute("href")).toBe("/write/date");
    expect(screen.getByRole("link", { name: "My profile" }).getAttribute("href")).toBe("/profile");
  });
});

describe("translations", () => {
  it("has English as a locale", () => {
    expect(locales).toContain("en");
  });
});
