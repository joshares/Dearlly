import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { WriteLetterClient } from "@/components/WriteLetterClient";
import { getMessages } from "@/i18n";
import { serverGet } from "@/lib/server-api";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.write.metaTitle };

type Quote = { key: string; title: string; text: string };

/** /write?quote=<key> (from the quotes page): the form starts with that quote filled in. */
export default async function WritePage({ searchParams }: { searchParams: Promise<{ quote?: string | string[] }> }) {
  const { quote } = await searchParams;
  const [loggedIn, quotes] = await Promise.all([
    seemsLoggedIn(),
    typeof quote === "string" ? serverGet<Quote[]>("/quotes") : null,
  ]);
  const chosen = quotes?.find((q) => q.key === quote);
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <WriteLetterClient loggedIn={loggedIn}
          start={chosen && { quoteTitle: chosen.title, quoteText: chosen.text }} />
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
