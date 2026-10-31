import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getMessages } from "@/i18n";

import { Safety } from "../safety/page";
import { Terms } from "./page";

afterEach(cleanup);

describe("terms and safety pages", () => {
  it.each([
    ["terms", Terms],
    ["safety", Safety],
  ] as const)("the %s page shows every section and how to reach us", (key, Page) => {
    render(<Page loggedIn={false} />);
    const doc = getMessages()[key];
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(doc.title);
    for (const section of doc.sections) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "hello@dearlly.app" }).getAttribute("href")).toBe("mailto:hello@dearlly.app");
  });

  it("says 18+, no money requests, and the emergency number", () => {
    render(<Terms loggedIn={false} />);
    expect(screen.getByText(/aged 18 and over/)).toBeTruthy();
    cleanup();
    render(<Safety loggedIn={false} />);
    expect(screen.getByRole("heading", { name: "Never send money" })).toBeTruthy();
    expect(screen.getByText(/call 112/)).toBeTruthy();
  });
});
