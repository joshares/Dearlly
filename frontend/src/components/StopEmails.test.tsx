import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { ReportLetter } from "./ReportLetter";
import { StopEmails } from "./StopEmails";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let posted: { path: string; body: unknown }[];

beforeEach(() => {
  resetApiState();
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (init.method === "POST") {
        posted.push({ path, body: JSON.parse(init.body as string) });
        return new Response(null, { status: 204 });
      }
      if (path === "/email/unsubscribe/good") return json(200, { sender: "@ada_demo" });
      return json(404, { detail: "This link has expired. Use the link in a newer email." });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("stops one sender", async () => {
  render(<StopEmails token="good" preferAll={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Stop letters from @ada_demo" }));
  expect(await screen.findByText(/won't get any more emails from @ada_demo/)).toBeTruthy();
  expect(posted).toEqual([{ path: "/email/unsubscribe/good", body: { scope: "sender" } }]);
});

it("stops every email", async () => {
  render(<StopEmails token="good" preferAll />);
  fireEvent.click(await screen.findByRole("button", { name: "Never email me again" }));
  expect(await screen.findByText("Done. Dearlly will never email you again.")).toBeTruthy();
  expect(posted[0]?.body).toEqual({ scope: "all" });
});

it("explains an expired link", async () => {
  render(<StopEmails token="old" preferAll={false} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/expired/);
});

it("reports a letter with a reason", async () => {
  render(<ReportLetter token="abc" />);
  fireEvent.click(screen.getByRole("button", { name: "Report this letter" }));
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Pick a reason first.");
  fireEvent.click(screen.getByLabelText("Scam or asking for money"));
  fireEvent.change(screen.getByLabelText(/Anything else/), { target: { value: "Asked for money" } });
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  expect(await screen.findByText(/Thank you. We'll look at it./)).toBeTruthy();
  expect(posted).toEqual([
    { path: "/letters/abc/report", body: { reason: "scam", note: "Asked for money" } },
  ]);
});

it("opens the report form straight away from the email link", () => {
  render(<ReportLetter token="abc" startOpen />);
  expect(screen.getByRole("button", { name: "Send report" })).toBeTruthy();
});
