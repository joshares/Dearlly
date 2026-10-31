import type { Metadata } from "next";
import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = {
  title: t.notFound.metaTitle,
  robots: { index: false, follow: false },
};

/** Any address that isn't a page: a "returned letter" with a way home. */
export default async function NotFound() {
  return <NotFoundPage loggedIn={await seemsLoggedIn()} />;
}

export function NotFoundPage({ loggedIn }: { loggedIn: boolean }) {
  const n = t.notFound;
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-2xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-10 md:pb-24">
        <section className="letter-sheet flex flex-col gap-5 rounded-sm py-10 pr-6 pl-12 md:py-14 md:pr-12 md:pl-16">
          <p className="-rotate-3 self-start rounded-sm border-[3px] border-stamp px-3 py-1 text-sm font-extrabold tracking-[0.16em] text-accent-text uppercase">
            {n.badge}
          </p>
          <h1 className="text-4xl leading-tight md:text-5xl">{n.title}</h1>
          <p className="text-lg leading-[1.8] text-muted">{n.lead}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/"
              className="inline-flex min-h-14 items-center justify-center rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper no-underline shadow-[4px_4px_0_var(--color-ink)]"
            >
              {n.home}
            </Link>
            <Link
              href="/write"
              className="inline-flex min-h-14 items-center justify-center rounded-lg border-2 border-fg px-6 text-lg font-extrabold no-underline"
            >
              {n.write}
            </Link>
          </div>
          <p className="text-sm text-muted">{n.letterHint}</p>
        </section>
      </main>
      <BottomNav t={t.nav} />
    </>
  );
}
