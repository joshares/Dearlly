import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { SentLetters } from "@/components/SentLetters";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";

const t = getMessages();

export const metadata: Metadata = { title: t.sent.metaTitle };

const PER_PAGE = 10;

export default async function LettersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const asked = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isFinite(asked) && asked >= 1 && asked <= 10_000 ? asked : 1;
  return (
    <>
      <SiteHeader t={t.header} />
      <main className="mx-auto w-full max-w-3xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <div className="letter-sheet rounded-sm py-8 pr-6 pl-12 md:py-12 md:pr-12 md:pl-16">
          {/* key: a fresh list for each page */}
          <SentLetters key={page} perPage={PER_PAGE} page={page} paged />
        </div>
      </main>
      <BottomNav t={t.nav} current="profile" />
    </>
  );
}
