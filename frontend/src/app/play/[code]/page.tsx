import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BottomNav } from "@/components/BottomNav";
import { GameRoom } from "@/components/GameRoom";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

// A game link is personal: never indexed, never passed on to other sites.
export const metadata: Metadata = {
  title: t.games.roomMetaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Both players need an account: straight to log in (and back here) if there's none.
  if (!(await seemsLoggedIn())) redirect(`/login?next=${encodeURIComponent(`/play/${code}`)}`);
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
