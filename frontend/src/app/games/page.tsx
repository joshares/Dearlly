import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { GameLibrary } from "@/components/GameLibrary";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.games.metaTitle };

export default async function GamesPage() {
  const loggedIn = await seemsLoggedIn();
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <GameLibrary loggedIn={loggedIn} />
      </main>
      <BottomNav t={t.nav} current="games" />
    </>
  );
}
