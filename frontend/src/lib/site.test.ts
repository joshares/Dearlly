import { describe, expect, it } from "vitest";

import { isPublicPath } from "@/lib/site";

describe("which pages search engines may list", () => {
  it("lists the public pages", () => {
    for (const path of ["/", "/quotes", "/date-ideas", "/date-ideas/lagos", "/games", "/privacy", "/terms", "/safety", "/sitemap.xml"]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("keeps everything else out, even pages added later", () => {
    for (const path of ["/l/abc", "/play/ABCD", "/admin", "/community", "/profile", "/letters", "/login", "/write", "/write/date", "/unsubscribe", "/date-ideas/lagos/extra", "/new-page"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});
