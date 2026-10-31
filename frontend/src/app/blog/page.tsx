import type { Metadata } from "next";
import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { ARTICLES, readingMinutes } from "@/content/blog";
import { getMessages } from "@/i18n";
import { lagosDate } from "@/lib/dates";
import { seemsLoggedIn } from "@/lib/session";
import { shareCard } from "@/lib/site";

const t = getMessages();
const b = t.blog;

export const metadata: Metadata = {
  title: b.metaTitle,
  description: b.metaDescription,
  alternates: { canonical: "/blog" },
  openGraph: shareCard(b.metaTitle, b.metaDescription),
};

export default async function BlogPage() {
  return <Blog loggedIn={await seemsLoggedIn()} />;
}

/** Public, indexable: every article, newest first. */
export function Blog({ loggedIn }: { loggedIn: boolean }) {
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <header className="flex flex-col gap-4">
          <h1 className="text-[2.6rem] leading-[1.05] md:text-6xl">{b.title}</h1>
          <p className="text-lg leading-[1.8] text-muted">{b.lead}</p>
        </header>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-5">
          {ARTICLES.map((article) => (
            <li key={article.slug}>
              <Link href={`/blog/${article.slug}`}
                className="letter-sheet flex flex-col gap-3 rounded-sm py-6 pr-5 pl-10 no-underline md:py-8 md:pl-14">
                <span className="text-sm text-muted">
                  {lagosDate(article.published)} · {b.readMinutes.replace("{minutes}", String(readingMinutes(article)))}
                </span>
                <span className="font-heading text-2xl leading-tight md:text-3xl">{article.title}</span>
                <span className="leading-[1.8] text-muted">{article.description}</span>
                <span className="font-extrabold text-accent-text underline">{b.read}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <BottomNav t={t.nav} current="home" />
    </>
  );
}
