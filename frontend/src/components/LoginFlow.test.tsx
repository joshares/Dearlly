import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { LoginFlow } from "./LoginFlow";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push }) }));
// Stand-in for Cloudflare's widget: passes immediately.
vi.mock("@/components/Turnstile", () => ({
  Turnstile: ({ onToken }: { onToken: (token: string) => void }) => (
    <button type="button" onClick={() => onToken("ok")}>
      pass check
    </button>
  ),
}));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let bodies: Record<string, unknown>;
let googleOn = false;

function mockApi(verifyStatus: "logged_in" | "signup_required", signup: Response) {
  bodies = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (init.body) bodies[path] = JSON.parse(init.body as string);
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/auth/providers") return json(200, { google: googleOn });
      if (path === "/auth/start") return json(202, { status: "code_sent" });
      if (path === "/auth/verify") return json(200, { status: verifyStatus, user: null });
      if (path.startsWith("/usernames/")) return json(200, { available: true, reason: null });
      if (path === "/auth/signup") return signup;
      if (path === "/auth/login") return json(200, { status: "logged_in", user: null });
      throw new Error(`unexpected ${path}`);
    }),
  );
}

async function reachCodeStep() {
  fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada_demo@x.com" } });
  const send = screen.getByRole("button", { name: "Email me a code" });
  expect((send as HTMLButtonElement).disabled).toBe(true); // waits for the human check
  fireEvent.click(screen.getByRole("button", { name: "pass check" }));
  fireEvent.click(send);
  await screen.findByText("Check your email");
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "12 34 56" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  resetApiState();
  push.mockReset();
  googleOn = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoginFlow", () => {
  it("logs an existing user in", async () => {
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow />);
    await reachCodeStep();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile"));
    expect(bodies["/auth/verify"]).toEqual({ email: "ada_demo@x.com", code: "123456" });
  });

  it("needs the 18+ tick before creating an account", async () => {
    mockApi("signup_required", json(201, { username: "ada_demo" }));
    render(<LoginFlow />);
    await reachCodeStep();
    await screen.findByText("Choose your name");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada_demo" } });
    const create = screen.getByRole("button", { name: "Create my account" });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /I'm 18 or older/ }));
    expect((create as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile"));
    expect(bodies["/auth/signup"]).toEqual({
      username: "ada_demo",
      display_name: null,
      is_adult: true,
      password: null,
    });
  });

  it("shows the server's reason when sign-up fails", async () => {
    mockApi("signup_required", json(409, { detail: "That username is taken." }));
    render(<LoginFlow />);
    await reachCodeStep();
    await screen.findByText("Choose your name");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada_demo" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I'm 18 or older/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That username is taken.");
    expect(push).not.toHaveBeenCalled();
  });

  it("logs in with a password instead of a code", async () => {
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow />);
    fireEvent.click(screen.getByLabelText("Use my password"));
    fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "ada_demo@x.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "lagoon-sunset-2027" } });
    fireEvent.click(screen.getByRole("button", { name: "pass check" }));
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile"));
    expect(bodies["/auth/login"]).toEqual({
      email: "ada_demo@x.com",
      password: "lagoon-sunset-2027",
      turnstile_token: "ok",
    });
  });

  it("offers a code when the password is forgotten", () => {
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow />);
    fireEvent.click(screen.getByLabelText("Use my password"));
    fireEvent.click(screen.getByRole("button", { name: /Forgot your password/ }));
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeTruthy();
  });

  it("hides Google until the server has it switched on", async () => {
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow />);
    await waitFor(() => expect(bodies).toBeDefined());
    expect(screen.queryByRole("link", { name: /Continue with Google/ })).toBeNull();
  });

  it("shows Google when it is configured", async () => {
    googleOn = true;
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow />);
    const link = await screen.findByRole("link", { name: /Continue with Google/ });
    expect(link.getAttribute("href")).toBe("http://localhost:8100/auth/google/start");
  });

  it("continues to the sign-up step after Google", async () => {
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow from="signup" />);
    expect(await screen.findByText("Choose your name")).toBeTruthy();
  });

  it("explains when Google sign-in failed", async () => {
    mockApi("logged_in", json(500, {}));
    render(<LoginFlow from="google-error" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Google sign-in didn't work/);
  });
});
