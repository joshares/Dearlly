import { describe, expect, it } from "vitest";

import { buildCsp, staticSecurityHeaders } from "./security-headers";

describe("buildCsp", () => {
  it("is strict in production", () => {
    const csp = buildCsp({ nonce: "abc", dev: false, apiOrigin: "https://api.dearlly.example/v1" });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self' https://api.dearlly.example");
  });

  it("allows dev tooling only in development", () => {
    const csp = buildCsp({ nonce: "abc", dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });
});

describe("staticSecurityHeaders", () => {
  const names = (production: boolean) => staticSecurityHeaders(production).map((h) => h.key);

  it("always sends the basics", () => {
    expect(names(false)).toEqual(
      expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]),
    );
  });

  it("adds HSTS only in production", () => {
    expect(names(false)).not.toContain("Strict-Transport-Security");
    expect(names(true)).toContain("Strict-Transport-Security");
  });
});
