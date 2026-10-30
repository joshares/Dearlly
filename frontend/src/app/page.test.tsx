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
    expect(new Set(hrefs)).toEqual(new Set(["/", "/login", "/privacy", "/profile", "/write"]));
  });

  it("offers sign-up as the main action", () => {
    render(<Home loggedIn={false} />);
    const cta = screen.getByRole("link", { name: getMessages().home.primaryCta });
    expect(cta.getAttribute("href")).toBe("/login");
  });
});

describe("home page when logged in", () => {
  it("drops 'Create your account' and offers writing and your letters", () => {
    render(<Home loggedIn />);
    const home = getMessages().home;
    expect(screen.queryByRole("link", { name: home.primaryCta })).toBeNull();
    expect(screen.getByRole("link", { name: home.secondaryCta }).getAttribute("href")).toBe("/write");
    expect(screen.getByRole("link", { name: home.lettersCta }).getAttribute("href")).toBe("/letters");
    expect(screen.getByRole("link", { name: "My profile" }).getAttribute("href")).toBe("/profile");
  });
});

describe("translations", () => {
  it("has English as a locale", () => {
    expect(locales).toContain("en");
  });
});
