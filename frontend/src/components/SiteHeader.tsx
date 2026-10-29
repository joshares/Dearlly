import Link from "next/link";

import { AccountLink } from "@/components/AccountLink";
import { Logo } from "@/components/brand";
import type { Messages } from "@/i18n";

/** Top bar: logo, and on laptops the main menu. Phones use the bottom bar instead. */
export function SiteHeader({ t }: { t: Messages["header"] }) {
  // Games and Our Stamp arrive in later stages, so they are labelled, not linked.
  const soon = [t.games, t.stamps];
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 py-4 pr-5 pl-9 md:px-12 md:py-6">
      <Link href="/" aria-label={t.home} className="text-fg no-underline">
        <Logo />
      </Link>
      <nav aria-label={t.label} className="flex items-center gap-8 text-[1.05rem] font-semibold">
        <ul className="hidden items-center gap-8 lg:flex">
          <li>
            <Link href="/write" className="text-fg hover:text-accent-text">
              {t.write}
            </Link>
          </li>
          {soon.map((label) => (
            <li key={label} className="flex items-center gap-2 text-muted">
              {label}
              <span className="rounded-full border border-line px-2 py-0.5 text-xs font-bold tracking-wide uppercase">
                {t.soon}
              </span>
            </li>
          ))}
        </ul>
        <AccountLink
          logIn={t.logIn}
          myProfile={t.myProfile}
          className="inline-flex min-h-12 items-center rounded-full border-2 border-fg px-5 font-bold text-fg hover:bg-fg hover:text-bg"
        />
      </nav>
    </header>
  );
}
