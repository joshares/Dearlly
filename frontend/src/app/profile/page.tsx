import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { ProfileView } from "@/components/ProfileView";
import { getMessages } from "@/i18n";

export const metadata: Metadata = { title: "Profile · Dearlly" };

export default function ProfilePage() {
  const t = getMessages();
  return (
    <>
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-8 pb-32">
        <p className="font-heading text-3xl">{t.brand.name}</p>
        <ProfileView />
      </main>
      <BottomNav t={t.nav} current="profile" />
    </>
  );
}
