import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { WriteLetterClient } from "@/components/WriteLetterClient";
import { getMessages } from "@/i18n";

const t = getMessages();

export const metadata: Metadata = { title: t.write.metaTitle };

export default function WritePage() {
  return (
    <>
      <SiteHeader t={t.header} />
      <main className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <WriteLetterClient />
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
