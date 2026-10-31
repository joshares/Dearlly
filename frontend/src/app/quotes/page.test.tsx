import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Quotes } from "./page";

afterEach(cleanup);

const QUOTES = [
  { key: "q07", mood: "romantic", title: "The answer", text: "Whatever the question is today — the answer is still you." },
  { key: "q12", mood: "playful", title: "Official notice", text: "You have been selected." },
  { key: "q13", mood: "playful", title: "Warning", text: "Side effects include smiling." },
];

describe("quotes page", () => {
  it("groups the quotes by mood, with a jump link for each", () => {
    render(<Quotes loggedIn={false} quotes={QUOTES} />);
    const jump = screen.getByRole("navigation", { name: "Jump to a mood" });
    expect(within(jump).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#romantic", "#playful"]);
    const playful = screen.getByRole("region", { name: "Playful" });
    expect(within(playful).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Official notice", "Warning"]);
  });

  it("sends each quote to the love note form", () => {
    render(<Quotes loggedIn={false} quotes={QUOTES} />);
    const card = screen.getByText("The answer").closest("li")!;
    expect(within(card).getByRole("link", { name: "Send this as a love note" }).getAttribute("href")).toBe("/write?quote=q07");
  });

  it("says so when the quotes couldn't load", () => {
    render(<Quotes loggedIn={false} quotes={null} />);
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't load/);
    expect(screen.getByRole("link", { name: "Write a love note" }).getAttribute("href")).toBe("/write");
  });
});
