import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("allows paths on this site", () => {
    expect(safeNext("/write")).toBe("/write");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "write", "", null])(
    "refuses %s",
    (bad) => {
      expect(safeNext(bad)).toBe("/profile");
    },
  );
});
