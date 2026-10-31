import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.safety.metaTitle };

export default async function SafetyPage() {
  return <Safety loggedIn={await seemsLoggedIn()} />;
}

/** How Dearlly keeps people safe, and how to stay safe (reporting, scams, dates, 112). */
export function Safety({ loggedIn }: { loggedIn: boolean }) {
  return <LegalPage doc={t.safety} loggedIn={loggedIn} />;
}
