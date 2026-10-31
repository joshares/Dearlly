import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.terms.metaTitle };

export default async function TermsPage() {
  return <Terms loggedIn={await seemsLoggedIn()} />;
}

/** The terms of use: the rules for using Dearlly, in plain English. */
export function Terms({ loggedIn }: { loggedIn: boolean }) {
  return <LegalPage doc={t.terms} loggedIn={loggedIn} />;
}
