import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BottomNav } from "@/components/BottomNav";
import { Postmark } from "@/components/brand";
import { ProfileView } from "@/components/ProfileView";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

export const metadata: Metadata = { title: "Profile · Dearlly" };

export default async function ProfilePage() {
  const t = getMessages();
  const loggedIn = await seemsLoggedIn();
  // Visitors go straight to log in, without a flash of an empty profile first.
  if (!loggedIn) redirect(`/login?next=${encodeURIComponent("/profile")}`);
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto grid w-full max-w-6xl gap-10 pt-4 pr-5 pb-36 pl-9 md:grid-cols-[1fr_240px] md:px-12 md:pt-8 md:pb-24">
        <div className="letter-sheet rounded-sm py-8 pr-6 pl-12 md:py-12 md:pr-12 md:pl-16">
          <ProfileView />
        </div>
        <Postmark
          text={t.loginPanel.postmark}
          size={200}
          className="hidden rotate-12 text-fg opacity-40 md:block"
        />
      </main>
      <BottomNav t={t.nav} current="profile" />
    </>
  );
}
