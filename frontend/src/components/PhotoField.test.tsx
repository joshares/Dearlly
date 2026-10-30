import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiState } from "@/lib/api";

import { NO_PHOTO, PhotoField, type PhotoValue } from "./PhotoField";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let enabled: boolean;
let verdict: Response | null;
let sent: { type: string; size: number } | null;

beforeEach(() => {
  resetApiState();
  enabled = true;
  verdict = null;
  sent = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path === "/photos/status") return json(200, { enabled, max_bytes: 10_485_760 });
      if (path === "/auth/csrf") return json(200, { csrf_token: "tok" });
      if (path === "/photos") {
        const body = init.body as Blob;
        sent = { type: (init.headers as Record<string, string>)["Content-Type"] ?? "", size: body.size };
        return verdict ?? json(201, {
          id: "p1",
          url: "http://localhost:8100/photos/p1.jpg?e=1&s=x",
          small_url: "http://localhost:8100/photos/p1.jpg?e=1&s=x&size=small",
          width: 800,
          height: 600,
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

function Harness({ loggedIn = true }: { loggedIn?: boolean }) {
  const [value, setValue] = useState<PhotoValue>(NO_PHOTO);
  return (
    <>
      <PhotoField value={value} onChange={setValue} loggedIn={loggedIn} next="/write" />
      <output data-testid="value">{value.photoId}</output>
    </>
  );
}

const photo = () => new File([new Uint8Array(2048)], "me.jpg", { type: "image/jpeg" });

describe("PhotoField", () => {
  it("uploads the chosen photo as itself and shows it", async () => {
    render(<Harness />);
    const input = (await screen.findByLabelText(/Add a photo/)) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [photo()] } });
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("p1"));
    expect(sent).toEqual({ type: "image/jpeg", size: 2048 });
    // The thumbnail uses the lighter phone copy.
    expect(screen.getByAltText("Your photo").getAttribute("src")).toContain("size=small");
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("says why a photo was refused", async () => {
    verdict = json(422, { detail: "This photo can't be used: Dearlly doesn't allow nudity or sexual content." });
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText(/Add a photo/), { target: { files: [photo()] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/doesn't allow nudity/);
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("asks logged-out writers to log in, and hides itself while photos are off", async () => {
    const { unmount } = render(<Harness loggedIn={false} />);
    expect((await screen.findByRole("link", { name: "Log in to add a photo" })).getAttribute("href")).toBe(
      "/login?next=%2Fwrite",
    );
    unmount();
    resetApiState();
    enabled = false;
    render(<Harness />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText(/Add a photo/)).toBeNull();
  });
});
