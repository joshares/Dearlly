import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { CommunityFeed, type Post } from "./CommunityFeed";

const replace = vi.fn();
// One router object, like Next.js's own (a new one per render would re-run effects).
const router = { push: replace, replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const photo = { url: "http://localhost:8100/photos/p.jpg?e=1&s=x", small_url: "http://localhost:8100/photos/p.jpg?e=1&s=x&size=small", width: 1200, height: 900 };
const post = (id: string, over: Partial<Post> = {}): Post => ({
  id, author: { username: "tolu_demo", display_name: null }, caption: `Caption ${id}`, photo,
  like_count: 2, liked: false, mine: false, created_at: "2026-10-31T10:00:00Z", ...over,
});

let calls: { path: string; method: string; body?: unknown }[];
let loggedIn: boolean;

beforeEach(() => {
  resetApiState();
  replace.mockReset();
  calls = [];
  loggedIn = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const method = init.method ?? "GET";
      calls.push({ path: u.pathname, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (u.pathname === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (u.pathname === "/auth/refresh") return json(401, { detail: "Please log in." });
      if (!loggedIn) return json(401, { detail: "Please log in." });
      if (u.pathname === "/community/feed") {
        return u.searchParams.get("before")
          ? json(200, { items: [post("old")], next_before: null })
          : json(200, { items: [post("top1", { like_count: 9 }), post("mine", { mine: true, author: { username: "ada_demo", display_name: null } }), post("b")], next_before: "2026-10-30T10:00:00Z" });
      }
      if (u.pathname === "/community/top") return json(200, { post: post("top1", { like_count: 9 }), picked: false });
      if (u.pathname.endsWith("/like")) return json(200, { like_count: method === "POST" ? 3 : 2, liked: method === "POST" });
      if (u.pathname.endsWith("/report")) return new Response(null, { status: 204 });
      if (u.pathname.startsWith("/community/posts/") && method === "DELETE") return new Response(null, { status: 204 });
      if (u.pathname === "/photos/status") return json(200, { enabled: true, max_bytes: 10_485_760 });
      if (u.pathname === "/photos")
        return json(201, { id: "p9", url: photo.url, small_url: photo.small_url, width: 800, height: 800 });
      if (u.pathname === "/community/posts")
        return json(201, post("new", { mine: true, caption: (JSON.parse(init.body as string) as { caption: string }).caption, like_count: 0 }));
      throw new Error(`unexpected ${u.pathname}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommunityFeed", () => {
  it("shows the top post of the week once, then the rest, and loads older ones", async () => {
    render(<CommunityFeed />);
    expect(await screen.findByText("🏆 Top post of the week")).toBeTruthy();
    expect(screen.getByText("Most loved this week")).toBeTruthy();
    expect(screen.getAllByText("Caption top1")).toHaveLength(1);
    expect(screen.getByText("Caption b")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show older stamps" }));
    expect(await screen.findByText("Caption old")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older stamps" })).toBeNull();
  });

  it("likes a stamp straight away, then keeps the server's count", async () => {
    render(<CommunityFeed />);
    const card = (await screen.findByText("Caption b")).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Like" }));
    expect(within(card).getByRole("button", { name: "Unlike" }).textContent).toContain("3");
    await waitFor(() => expect(calls.some((c) => c.path === "/community/posts/b/like" && c.method === "POST")).toBe(true));
  });

  it("deletes your own stamp after confirming, and reports others'", async () => {
    render(<CommunityFeed />);
    const mine = (await screen.findByText("Caption mine")).closest("article") as HTMLElement;
    fireEvent.click(within(mine).getByRole("button", { name: "More options" }));
    expect(within(mine).queryByRole("button", { name: "Report" })).toBeNull();
    fireEvent.click(within(mine).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(mine).getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(screen.queryByText("Caption mine")).toBeNull());

    const theirs = screen.getByText("Caption b").closest("article") as HTMLElement;
    fireEvent.click(within(theirs).getByRole("button", { name: "More options" }));
    fireEvent.click(within(theirs).getByRole("button", { name: "Report" }));
    fireEvent.click(within(theirs).getByLabelText("Spam"));
    fireEvent.click(within(theirs).getByRole("button", { name: "Send report" }));
    expect(await within(theirs).findByText("Thank you. We'll look at it.")).toBeTruthy();
    expect(calls.find((c) => c.path === "/community/posts/b/report")?.body).toEqual({ reason: "spam", note: null });
  });

  it("posts a stamp with a photo and a caption", async () => {
    render(<CommunityFeed />);
    fireEvent.click(await screen.findByRole("button", { name: "Post a stamp" }));
    const post = screen.getByRole("button", { name: "Post it" }) as HTMLButtonElement;
    expect(post.disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText(/Your photo/), { target: { files: [new File([new Uint8Array(1024)], "a.jpg", { type: "image/jpeg" })] } });
    fireEvent.change(screen.getByLabelText(/Caption/), { target: { value: "Sunday picnic 🧺" } });
    await waitFor(() => expect(post.disabled).toBe(false));
    fireEvent.click(post);
    expect(await screen.findByText("Sunday picnic 🧺")).toBeTruthy();
    expect(calls.find((c) => c.path === "/community/posts")?.body).toEqual({ photo_id: "p9", caption: "Sunday picnic 🧺" });
  });

  it("sends people who aren't logged in to log in", async () => {
    loggedIn = false;
    render(<CommunityFeed />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fcommunity"));
  });
});
