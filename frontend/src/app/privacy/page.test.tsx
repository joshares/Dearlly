import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getMessages } from "@/i18n";

import { Privacy } from "./page";

afterEach(cleanup);

describe("privacy page", () => {
  it("shows every section and a way to contact us", () => {
    render(<Privacy loggedIn={false} />);
    const p = getMessages().privacy;
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(p.title);
    for (const section of p.sections) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: p.contactEmail }).getAttribute("href")).toBe(
      "mailto:hello@dearlly.app",
    );
  });
});
