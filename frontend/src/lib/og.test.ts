import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The preview pictures for private links must never read the link itself.
describe("private link previews", () => {
  for (const file of ["src/app/l/[token]/opengraph-image.tsx", "src/app/play/[code]/opengraph-image.tsx"]) {
    it(`${file} doesn't look at the letter or game`, () => {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/params|serverGet|fetch\(|api\(/);
    });
  }
});
