import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { WriteGiftClient } from "@/components/WriteLetterClient";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.gift.metaTitle };

export default async function WriteGiftPage() {
  const loggedIn = await seemsLoggedIn();
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <WriteGiftClient loggedIn={loggedIn} />
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
