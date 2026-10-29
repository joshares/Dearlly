import type { Metadata } from "next";
import { headers } from "next/headers";

import { BottomNav } from "@/components/BottomNav";
import { LoginFlow } from "@/components/LoginFlow";
import { getMessages } from "@/i18n";

export const metadata: Metadata = { title: "Log in · Dearlly" };

export default async function LoginPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const t = getMessages();
  return (
    <>
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-8 pb-32">
        <p className="font-heading text-3xl">{t.brand.name}</p>
        <LoginFlow nonce={nonce} />
      </main>
      <BottomNav t={t.nav} current="profile" />
    </>
  );
}
