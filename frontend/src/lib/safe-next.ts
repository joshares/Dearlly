/**
 * Where to go after logging in. Only paths on this site are allowed ("/write"), never another
 * site ("https://evil.example", "//evil.example"), so the login page can't be used to redirect
 * people somewhere harmful.
 */
export function safeNext(next: string | null | undefined, fallback = "/profile"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}
