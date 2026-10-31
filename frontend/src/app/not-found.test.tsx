import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NotFoundPage } from "./not-found";

afterEach(cleanup);

describe("not found page", () => {
  it("says the page is lost and leads home", () => {
    render(<NotFoundPage loggedIn={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This page got lost in the post.");
    expect(screen.getByRole("link", { name: "Go to the home page" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Write a love note" }).getAttribute("href")).toBe("/write");
    // The phone menu is there too, with nothing marked as the current page.
    expect(screen.getByRole("navigation", { name: "Main" }).querySelector('[aria-current="page"]')).toBeNull();
  });
});
