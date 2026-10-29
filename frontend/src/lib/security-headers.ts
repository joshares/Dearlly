/**
 * Security headers for every page.
 *
 * The Content-Security-Policy carries a fresh nonce per request (set in src/proxy.ts), so only
 * scripts Next.js itself rendered can run. The other headers are fixed and set in next.config.ts.
 */

// Cloudflare Turnstile (bot check on log-in) runs in an iframe from here.
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export type CspOptions = {
  nonce: string;
  dev: boolean;
  apiOrigin?: string;
};

export function buildCsp({ nonce, dev, apiOrigin }: CspOptions): string {
  const connect = ["'self'"];
  if (apiOrigin) connect.push(new URL(apiOrigin).origin);
  if (dev) connect.push("ws:"); // hot reload

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in development: React's dev tooling needs it.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": connect,
    "media-src": ["'self'"],
    "frame-src": [TURNSTILE_ORIGIN],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function staticSecurityHeaders(production: boolean): { key: string; value: string }[] {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
  if (production) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }
  return headers;
}
