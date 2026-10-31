import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Nothing is blocked here on purpose: a blocked address can still be listed (bare, without
    // its page), and a private letter's address is its secret. Instead every private page says
    // "noindex" itself (src/proxy.ts), which search engines only see if they may visit it.
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
