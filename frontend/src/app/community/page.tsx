import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BottomNav } from "@/components/BottomNav";
import { CommunityFeed } from "@/components/CommunityFeed";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

// Members only: never indexed, never passed on to other sites.
export const metadata: Metadata = {
  title: t.community.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CommunityPage() {
  if (!(await seemsLoggedIn())) redirect(`/login?next=${encodeURIComponent("/community")}`);
  return (
    <>
      <SiteHeader t={t.header} loggedIn />
      <main className="mx-auto w-full max-w-5xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <CommunityFeed />
      </main>
      <BottomNav t={t.nav} current="stamps" />
    </>
  );
}
