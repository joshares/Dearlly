import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { WriteLetter } from "./WriteLetter";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push }) }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let created: Record<string, unknown> | null;
let loggedIn: boolean;

beforeEach(() => {
  resetApiState();
  push.mockReset();
  window.localStorage.clear();
  created = null;
  loggedIn = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/quotes")
        return json(200, [{ key: "q33", mood: "romantic", title: "Na you", text: "Na you my heart choose." }]);
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/auth/refresh") return json(401, { detail: "Please log in." });
      if (path === "/experiences") {
        if (!loggedIn) return json(401, { detail: "Please log in." });
        created = JSON.parse(init.body as string);
        return json(201, {
          url: "https://dearlly.app/l/abc123abc123abc123abc123abc123ab",
          opens_at: null,
          email_status: created?.recipient_email ? "scheduled" : null,
        });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillIn() {
  fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Their name"), { target: { value: "Tolu" } });
  fireEvent.change(screen.getByLabelText(/What you call them/), { target: { value: "my love" } });
}

describe("WriteLetter", () => {
  it("fills the letter from a quote and shows it in the preview", async () => {
    render(<WriteLetter />);
    fillIn();
    fireEvent.click(await screen.findByRole("button", { name: "Use this" }));
    expect((screen.getByLabelText(/Your message/) as HTMLTextAreaElement).value).toBe(
      "Na you my heart choose.",
    );
    expect(screen.getAllByText("Dear my love,").length).toBeGreaterThan(0);
  });

  it("can't be sealed until the essentials are filled in", () => {
    render(<WriteLetter />);
    const seal = screen.getByRole("button", { name: "Seal it" }) as HTMLButtonElement;
    expect(seal.disabled).toBe(true);
    fillIn();
    fireEvent.change(screen.getByLabelText(/Your message/), { target: { value: "Hi" } });
    expect(seal.disabled).toBe(false);
  });

  it("seals the letter and offers WhatsApp and copy", async () => {
    render(<WriteLetter />);
    fillIn();
    fireEvent.change(screen.getByLabelText(/Your message/), { target: { value: "You are my person." } });
    fireEvent.change(screen.getByLabelText(/Keep it sealed until/), {
      target: { value: "2027-02-14T00:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Seal it" }));
    expect(await screen.findByText("Sealed with love.")).toBeTruthy();
    expect(created).toMatchObject({
      type: "love_note",
      sender_name: "Ada",
      recipient_title: "my love",
      content: { quote_text: "You are my person." },
      opens_at: "2027-02-14T00:00:00+01:00",
    });
    const whatsapp = screen.getByRole("link", { name: "Send on WhatsApp" }).getAttribute("href");
    expect(whatsapp).toContain("https://wa.me/?text=");
    expect(decodeURIComponent(whatsapp ?? "")).toContain("https://dearlly.app/l/");
    expect(window.localStorage.getItem("dearlly:draft:love_note")).toBeNull();
  });

  it("can email the link to them", async () => {
    render(<WriteLetter loggedIn />);
    fillIn();
    fireEvent.change(screen.getByLabelText(/Your message/), { target: { value: "Hi" } });
    fireEvent.change(screen.getByLabelText(/Their email/), { target: { value: " tolu_demo@example.com " } });
    expect(screen.queryByText(/create a free account/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seal it" }));
    expect(await screen.findByText("We'll email it to tolu_demo@example.com within a minute.")).toBeTruthy();
    expect(created).toMatchObject({ recipient_email: "tolu_demo@example.com" });
  });

  it("asks for an account at the seal step and keeps the draft", async () => {
    loggedIn = false;
    render(<WriteLetter />);
    fillIn();
    fireEvent.change(screen.getByLabelText(/Your message/), { target: { value: "Kept safe." } });
    fireEvent.click(screen.getByRole("button", { name: "Seal it" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?next=%2Fwrite"));
    const saved = JSON.parse(window.localStorage.getItem("dearlly:draft:love_note") ?? "{}");
    expect(saved.quoteText).toBe("Kept safe.");
  });

  it("restores a saved draft", () => {
    window.localStorage.setItem(
      "dearlly:draft:love_note",
      JSON.stringify({ senderName: "Ada", recipientName: "Tolu", quoteText: "Back again" }),
    );
    render(<WriteLetter />);
    expect((screen.getByLabelText(/Your message/) as HTMLTextAreaElement).value).toBe("Back again");
  });
});
