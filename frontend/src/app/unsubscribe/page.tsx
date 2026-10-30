import type { Metadata } from "next";

import { SiteHeader } from "@/components/SiteHeader";
import { StopEmails } from "@/components/StopEmails";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

// The link carries a personal key: never indexed, never passed on to other sites.
export const metadata: Metadata = {
  title: t.unsubscribe.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; all?: string }>;
}) {
  const params = await searchParams;
  const loggedIn = await seemsLoggedIn();
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-2xl pt-4 pr-5 pb-24 pl-9 md:px-12 md:pt-8">
        <div className="letter-sheet rounded-sm py-8 pr-6 pl-12 md:py-12 md:pr-12 md:pl-16">
          <StopEmails token={params.t ?? ""} preferAll={params.all === "1"} />
        </div>
      </main>
    </>
  );
}
