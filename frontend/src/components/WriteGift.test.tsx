import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { WriteGift } from "./WriteGift";

const push = vi.fn();
// One router object, like Next.js's own (a new one per render would re-run effects).
const router = { push, replace: push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let created: Record<string, unknown> | null;

beforeEach(() => {
  resetApiState();
  window.localStorage.clear();
  created = null;
  vi.stubGlobal("HTMLCanvasElement", class { getContext() { return null; } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/experiences") {
        created = JSON.parse(init.body as string);
        return json(201, { url: "https://dearlly.app/l/abc123abc123abc123abc123abc123ab", opens_at: null, email_status: null });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WriteGift", () => {
  it("hides the gift in the preview's stamp and seals it", async () => {
    render(<WriteGift loggedIn />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/^Their name/), { target: { value: "Tolu" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Use this" })[0]!);
    const seal = screen.getByRole("button", { name: "Seal it" }) as HTMLButtonElement;
    expect(seal.disabled).toBe(true); // no gift yet
    fireEvent.change(screen.getByLabelText(/What's the gift/), { target: { value: "A spa day" } });
    fireEvent.change(screen.getByLabelText(/A hint on the stamp/), { target: { value: "Relax" } });
    // The sender can try the stamp in the preview; the letter itself never shows the gift.
    expect(screen.getAllByText("Try it: this is what they'll see").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A spa day")[0]!.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(seal);
    expect(await screen.findByText("Sealed with love.")).toBeTruthy();
    expect(created).toMatchObject({
      type: "gift_reveal",
      content: { message: "I saw this and thought of you.", gift: "A spa day", hint: "Relax", note: null },
    });
  });
});
