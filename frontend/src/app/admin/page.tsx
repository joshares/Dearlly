import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminPanel } from "@/components/AdminPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

// Only admins see anything here (the API checks every request). Never indexed.
export const metadata: Metadata = {
  title: t.admin.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AdminPage() {
  if (!(await seemsLoggedIn())) redirect(`/login?next=${encodeURIComponent("/admin")}`);
  return (
    <>
      <SiteHeader t={t.header} loggedIn />
      <main className="mx-auto w-full max-w-5xl pt-4 pr-5 pb-24 pl-9 md:px-12 md:pt-8">
        <AdminPanel />
      </main>
    </>
  );
}
