import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { HeroArt, Logo } from "@/components/brand";
import { LoginFlow } from "@/components/LoginFlow";
import { getMessages } from "@/i18n";
import { safeNext } from "@/lib/safe-next";
import { seemsLoggedIn } from "@/lib/session";

export const metadata: Metadata = { title: "Log in · Dearlly" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string; next?: string }>;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const params = await searchParams;
  const from =
    params.step === "signup" ? "signup" : params.error === "google" ? "google-error" : undefined;
  const t = getMessages();
  return (
    <>
      <div className="grid min-h-[calc(100dvh-2*var(--frame))] md:grid-cols-2">
        {/* Brand panel: laptops only. */}
        <aside className="relative hidden flex-col justify-between overflow-hidden border-r-2 border-dashed border-line bg-surface/70 p-12 md:flex">
          <Link href="/" aria-label={t.header.home} className="text-fg">
            <Logo />
          </Link>
          <div className="relative flex justify-center">
            <div className="w-full max-w-[460px] -rotate-3">
              <HeroArt
                label={t.home.art.label}
                letterTo={t.home.art.to}
                letterBody={t.home.art.body}
              />
            </div>
          </div>
          <p className="font-hand max-w-md text-2xl leading-[1.8]">“{t.loginPanel.quote}”</p>
        </aside>

        <main className="flex flex-col gap-6 pt-5 pr-3 pb-32 pl-5 md:items-center md:justify-center md:p-12">
          <Link href="/" aria-label={t.header.home} className="text-fg md:hidden">
            <Logo size={34} />
          </Link>
          <div className="letter-sheet w-full max-w-lg rounded-sm py-8 pr-3 pl-9 md:rotate-1 md:py-12 md:pr-10 md:pl-16">
            <LoginFlow
              nonce={nonce}
              from={from}
              next={safeNext(params.next)}
              checking={await seemsLoggedIn()}
            />
          </div>
        </main>
      </div>
      <BottomNav t={t.nav} current="profile" />
    </>
  );
}
