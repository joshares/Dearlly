import type { Metadata } from "next";

import { OpenLetter } from "@/components/OpenLetter";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

// The link is the only key to the letter: never indexed, and never passed on to other sites.
// The title stays generic so link previews (WhatsApp) don't reveal who it's from.
export const metadata: Metadata = {
  title: t.letter.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function LetterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loggedIn = await seemsLoggedIn();
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-2xl pt-4 pr-5 pb-24 pl-9 md:px-12 md:pt-8">
        <OpenLetter token={token} />
      </main>
    </>
  );
}
