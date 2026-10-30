import { NextResponse, type NextRequest } from "next/server";

import { buildCsp } from "@/lib/security-headers";

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    apiOrigin: process.env.NEXT_PUBLIC_API_URL,
  });

  // Next.js reads the nonce from the request's CSP header and stamps it on its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);
  // Pages read this to load third-party scripts (Turnstile) with the same nonce.
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // Private letters (/l/<token>) and email links: never indexed, even if a link leaks.
  if (request.nextUrl.pathname.startsWith("/l/") || request.nextUrl.pathname === "/unsubscribe") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
