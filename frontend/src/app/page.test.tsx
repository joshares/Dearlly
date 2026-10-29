import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages, locales } from "@/i18n";

import HomePage from "./page";

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
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(getMessages().home.title);
  });

  it("has phone navigation with Home as the current page", () => {
    render(<HomePage />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const home = nav.querySelector('[aria-current="page"]');
    expect(home?.textContent).toContain("Home");
    expect(home?.getAttribute("href")).toBe("/");
  });

  it("links only to pages that exist", () => {
    render(<HomePage />);
    const hrefs = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(new Set(hrefs)).toEqual(new Set(["/", "/login", "/profile", "/write"]));
  });

  it("offers sign-up as the main action", () => {
    render(<HomePage />);
    const cta = screen.getByRole("link", { name: getMessages().home.primaryCta });
    expect(cta.getAttribute("href")).toBe("/login");
  });
});

describe("translations", () => {
  it("has English as a locale", () => {
    expect(locales).toContain("en");
  });
});
