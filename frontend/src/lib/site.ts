/**
 * The public face of the site: its address, and the pages search engines may list.
 * Every other page is sent with "noindex" (see src/proxy.ts), so a new page stays private
 * until it is added here on purpose.
 */

export const SITE_URL = (process.env.SITE_URL ?? "https://dearlly.app").replace(/\/$/, "");

export const PUBLIC_PAGES = ["/", "/quotes", "/date-ideas", "/blog", "/games", "/privacy", "/terms", "/safety"] as const;

export function isPublicPath(path: string): boolean {
  if ((PUBLIC_PAGES as readonly string[]).includes(path)) return true;
  if (path === "/robots.txt" || path === "/sitemap.xml") return true;
  return /^\/(date-ideas|blog)\/[a-z0-9_-]+$/.test(path);
}

/**
 * The title and line shown under a shared link's picture. A page's own openGraph replaces the
 * site-wide one (it isn't merged), so every page that sets it goes through here.
 */
export function shareCard(title: string, description: string) {
  return { siteName: "Dearlly", type: "website" as const, title, description };
}
