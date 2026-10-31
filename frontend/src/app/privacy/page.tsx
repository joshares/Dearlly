import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.privacy.metaTitle };

export default async function PrivacyPage() {
  return <Privacy loggedIn={await seemsLoggedIn()} />;
}

/** The privacy notice (NDPA 2023). The words live in the messages file, so they can be translated. */
export function Privacy({ loggedIn }: { loggedIn: boolean }) {
  return <LegalPage doc={t.privacy} loggedIn={loggedIn} />;
}
