import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { ProfileView } from "./ProfileView";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: replace }) }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const ME = {
  id: "1",
  username: "ada_demo",
  display_name: null,
  email: "ada_demo@example.com",
  plan: "free",
  created_at: "2026-10-29T00:00:00Z",
};

let deleted: unknown = null;

beforeEach(() => {
  resetApiState();
  replace.mockReset();
  deleted = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/me") return json(200, ME);
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
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
});
