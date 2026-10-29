import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getMessages, locales } from "@/i18n";

import HomePage from "./page";

afterEach(cleanup);

describe("home page", () => {
  it("shows the headline from the translation file", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(getMessages().home.title);
  });

  it("has bottom navigation with Home as the current page", () => {
    render(<HomePage />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const home = nav.querySelector('[aria-current="page"]');
    expect(home?.textContent).toContain("Home");
    expect(home?.getAttribute("href")).toBe("/");
  });

  it("does not pretend unbuilt features work", () => {
    render(<HomePage />);
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole("navigation").querySelectorAll("a")).toHaveLength(1);
  });
});

describe("translations", () => {
  it("has English as a locale", () => {
    expect(locales).toContain("en");
  });
});
