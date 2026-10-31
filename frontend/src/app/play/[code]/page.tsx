import type { Metadata } from "next";
import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { GameRoom } from "@/components/GameRoom";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";
import { shareCard } from "@/lib/site";

const t = getMessages();

// A game link is personal: never indexed, never passed on to other sites.
export const metadata: Metadata = {
  title: t.games.roomMetaTitle,
  openGraph: shareCard(t.games.roomMetaTitle, t.og.play.line),
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!(await seemsLoggedIn())) return <PlayGuest code={code} />;
  return (
    <>
      <SiteHeader t={t.header} loggedIn />
      <main className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <GameRoom code={code.toUpperCase()} />
      </main>
      <BottomNav t={t.nav} current="games" />
    </>
  );
}

/**
 * Both players need an account. Without one, a short invitation with the way in (and back),
 * rather than a jump to log in: link previews (WhatsApp) then show "Come play with me", not the
 * log-in page. Nothing about the game itself is read here.
 */
export function PlayGuest({ code }: { code: string }) {
  const g = t.games;
  return (
    <>
      <SiteHeader t={t.header} loggedIn={false} />
      <main className="mx-auto w-full max-w-2xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-10 md:pb-24">
        <section className="letter-sheet flex flex-col gap-5 rounded-sm py-10 pr-6 pl-12 md:py-14 md:pr-12 md:pl-16">
          <h1 className="text-4xl leading-tight md:text-5xl">{g.guestTitle}</h1>
          <p className="text-lg leading-[1.8]">{g.guestLead}</p>
          <p className="leading-[1.8] text-muted">{g.guestNeed}</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/play/${code}`)}`}
            className="inline-flex min-h-14 items-center justify-center self-start rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper no-underline shadow-[4px_4px_0_var(--color-ink)]"
          >
            {g.guestCta}
          </Link>
        </section>
      </main>
      <BottomNav t={t.nav} current="games" />
    </>
  );
}
