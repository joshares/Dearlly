import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlayGuest } from "./page";

afterEach(cleanup);

describe("a game link without an account", () => {
  it("invites them in and brings them back to this game after logging in", () => {
    render(<PlayGuest code="AB12CD" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("You're invited to play");
    expect(screen.getByRole("link", { name: "Log in to play" }).getAttribute("href")).toBe("/login?next=%2Fplay%2FAB12CD");
  });
});
