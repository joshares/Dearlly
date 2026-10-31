import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DateIdeas } from "../page";
import { CityDateIdeas } from "./page";

afterEach(cleanup);

const CITIES = [
  { key: "lagos", name: "Lagos", place_count: 2 },
  { key: "abuja", name: "Abuja", place_count: 1 },
];
const SOURCE = { publisher: "Discover Lagos", title: "Date spots", url: "https://example.com/a", published: null, rank: 1 };
const SHIRO = {
  key: "shiro", name: "Shiro Lagos", area: "Victoria Island", address: null, kind: "restaurant",
  vibes: ["romantic_dinner" as const, "luxury" as const], price: 3, price_note: "About ₦35,000 a person", sources: [SOURCE],
};
const BEACH = { ...SHIRO, key: "tarkwa-bay", name: "Tarkwa Bay", area: "Lagos Harbour", vibes: ["beach" as const], price_note: null,
  sources: [SOURCE, { ...SOURCE, publisher: "Pulse", url: "https://example.com/b", rank: null }] };

describe("date ideas", () => {
  it("lists the cities with their place counts", () => {
    render(<DateIdeas loggedIn={false} cities={CITIES} />);
    const lagos = screen.getByRole("link", { name: /Lagos/ });
    expect(lagos.getAttribute("href")).toBe("/date-ideas/lagos");
    expect(lagos.textContent).toContain("2 places");
  });

  it("shows each place once, under its main kind of date, with its guides", () => {
    render(<CityDateIdeas loggedIn={false} city={CITIES[0]!} cities={CITIES} places={[SHIRO, BEACH]} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Date ideas in Lagos");
    expect(screen.getAllByText("Shiro Lagos")).toHaveLength(1);
    const dinner = screen.getByRole("region", { name: "Romantic dinner" });
    expect(within(dinner).getByText("Shiro Lagos")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Luxury" })).toBeNull();
    const beach = screen.getByRole("region", { name: "Beach" });
    expect(within(beach).getByText("Featured in 2 guides")).toBeTruthy();
    expect(within(beach).getByRole("link", { name: "Listed by Pulse" }).getAttribute("rel")).toContain("noopener");
  });

  it("invites them to that place, and links the other cities", () => {
    render(<CityDateIdeas loggedIn={false} city={CITIES[0]!} cities={CITIES} places={[SHIRO]} />);
    const card = screen.getByText("Shiro Lagos").closest("li")!;
    expect(within(card).getByRole("link", { name: "Invite them here" }).getAttribute("href")).toBe("/write/date?city=lagos&place=shiro");
    const others = screen.getByRole("region", { name: "Other cities" });
    expect(within(others).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/date-ideas/abuja"]);
  });
});
