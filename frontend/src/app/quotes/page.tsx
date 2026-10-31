import type { Metadata } from "next";
import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { serverGet } from "@/lib/server-api";
import { seemsLoggedIn } from "@/lib/session";
import { shareCard } from "@/lib/site";

const t = getMessages();

export const metadata: Metadata = {
  title: t.quotes.metaTitle,
  description: t.quotes.metaDescription,
  alternates: { canonical: "/quotes" },
  openGraph: shareCard(t.quotes.metaTitle, t.quotes.metaDescription),
};

type Mood = keyof typeof t.write.moods;
const MOODS = Object.keys(t.write.moods) as Mood[];

export type Quote = { key: string; mood: string; title: string; text: string };

export default async function QuotesPage() {
  const [loggedIn, quotes] = await Promise.all([seemsLoggedIn(), serverGet<Quote[]>("/quotes")]);
  return <Quotes loggedIn={loggedIn} quotes={quotes} />;
}

/** Public, indexable: every quote in the library, by mood, each one a tap away from a love note. */
export function Quotes({ loggedIn, quotes }: { loggedIn: boolean; quotes: Quote[] | null }) {
  const q = t.quotes;
  const groups = MOODS.map((mood) => ({ mood, items: (quotes ?? []).filter((x) => x.mood === mood) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <header className="flex max-w-3xl flex-col gap-4">
          <h1 className="text-[2.6rem] leading-[1.05] md:text-6xl">{q.title}</h1>
          <p className="text-lg leading-[1.8] text-muted">{q.lead}</p>
        </header>

        {quotes === null ? (
          <p role="alert" className="font-semibold">{q.failed}</p>
        ) : (
          <>
            <nav aria-label={q.moodsLabel} className="flex flex-wrap gap-2">
              {groups.map(({ mood }) => (
                <a key={mood} href={`#${mood}`}
                  className="inline-flex min-h-12 items-center rounded-full border-2 border-line px-4 text-sm font-bold no-underline">
                  {t.write.moods[mood]}
                </a>
              ))}
            </nav>
            {groups.map(({ mood, items }) => (
              <section key={mood} id={mood} aria-labelledby={`${mood}-h`} className="flex scroll-mt-6 flex-col gap-5">
                <h2 id={`${mood}-h`} className="text-3xl md:text-4xl">{t.write.moods[mood]}</h2>
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((quote) => (
                    <li key={quote.key} className="letter-sheet flex flex-col gap-4 rounded-sm py-6 pr-5 pl-10">
                      <h3 className="text-xl">{quote.title}</h3>
                      <p className="font-hand flex-1 leading-[2.1]">{quote.text}</p>
                      <Link href={`/write?quote=${encodeURIComponent(quote.key)}`}
                        className="inline-flex min-h-12 items-center justify-center self-start rounded-lg border-2 border-fg px-4 font-extrabold no-underline">
                        {q.send}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        <section className="flex flex-col gap-3 border-t-2 border-dashed border-line pt-8">
          <h2 className="text-3xl">{q.ctaHeading}</h2>
          <p className="text-lg leading-[1.8] text-muted">{q.ctaBody}</p>
          <Link href="/write"
            className="inline-flex min-h-14 items-center justify-center self-start rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper no-underline shadow-[4px_4px_0_var(--color-ink)]">
            {q.cta}
          </Link>
        </section>
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
