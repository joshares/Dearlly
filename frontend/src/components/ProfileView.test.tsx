import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { ProfileView } from "./ProfileView";

const replace = vi.fn();
// One router object, like Next.js's own (a new one per render would re-run effects).
const router = { replace, push: replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ME = {
  id: "1",
  username: "ada_demo",
  display_name: null,
  email: "ada_demo@example.com",
  plan: "free",
  has_password: false,
  created_at: "2026-10-29T00:00:00Z",
};

let deleted: unknown = null;
let passwordBody: unknown = null;

beforeEach(() => {
  resetApiState();
  replace.mockReset();
  deleted = null;
  passwordBody = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/me") return json(200, ME);
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/me/password") {
        passwordBody = JSON.parse(init.body as string);
        return new Response(null, { status: 204 });
      }
      if (path === "/me/delete") {
        deleted = JSON.parse(init.body as string);
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${path}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProfileView", () => {
  it("shows the email only to its owner, marked private", async () => {
    render(<ProfileView />);
    expect(await screen.findByText("@ada_demo")).toBeTruthy();
    expect(screen.getByText("Only you can see this.")).toBeTruthy();
  });

  it("deletes the account only after the username is retyped", async () => {
    render(<ProfileView />);
    await screen.findByText("@ada_demo");
    const button = screen.getByRole("button", { name: "Delete my account forever" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type your username/), { target: { value: "ADA_demo" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(deleted).toEqual({ confirm_username: "ADA_demo" });
  });

  it("adds a first password without asking for a current one", async () => {
    render(<ProfileView />);
    await screen.findByText("@ada_demo");
    fireEvent.change(screen.getByLabelText(/New password/), {
      target: { value: "lagoon-sunset-2027" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add password" }));
    await screen.findByRole("button", { name: "Password saved" });
    expect(passwordBody).toEqual({ current_password: null, new_password: "lagoon-sunset-2027" });
  });
});
