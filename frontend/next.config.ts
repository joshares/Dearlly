import type { NextConfig } from "next";

import { staticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Small self-contained server for the Docker image (no npm needed at runtime).
  output: "standalone",
  // The fonts for link preview pictures are read from disk, so ship them with the server.
  outputFileTracingIncludes: { "/**": ["./src/fonts/og/*"] },
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Pages are made per visit (each carries its own security nonce). Keep a visited page in the
    // phone's memory for 30 seconds so going back and forth is instant. Logging in or out
    // refreshes it straight away.
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: staticSecurityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
};

export default nextConfig;
