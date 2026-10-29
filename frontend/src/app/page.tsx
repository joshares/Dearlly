import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { HeroArt } from "@/components/brand";
import { SiteHeader } from "@/components/SiteHeader";
import { StampCard } from "@/components/StampCard";
import { getMessages } from "@/i18n";

const EXPERIENCES = [
  { key: "loveNote", tone: "kraft", tilt: "-rotate-3" },
  { key: "date", tone: "stamp", tilt: "rotate-2" },
  { key: "vacation", tone: "ink", tilt: "-rotate-1" },
  { key: "gift", tone: "paper", tilt: "rotate-3" },
] as const;

export default function HomePage() {
  const t = getMessages();
  const home = t.home;

  return (
    <>
      <SiteHeader t={t.header} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 pt-4 pr-5 pb-36 pl-9 md:gap-24 md:px-12 md:pt-10 md:pb-24">
        <section className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <div className="flex flex-col gap-5 md:gap-6">
            <p className="flex items-center gap-2 self-start rounded-full border-2 border-stamp px-4 py-1.5 text-xs font-extrabold tracking-[0.14em] text-accent-text uppercase">
              <span className="h-2 w-2 rounded-full bg-stamp" aria-hidden="true" />
              {home.badge}
            </p>
            <p className="font-hand text-xl leading-[2.2] md:text-2xl">{home.opener}</p>
            <h1 className="text-[2.9rem] leading-[1] tracking-tight sm:text-6xl lg:text-[5.4rem]">
              {home.title}
            </h1>
            <p className="max-w-xl text-lg leading-[1.8] text-muted md:text-xl">{home.lead}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href="/login"
                className="inline-flex min-h-14 items-center justify-center rounded-lg bg-stamp px-7 whitespace-nowrap text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5 dark:shadow-[4px_4px_0_var(--color-paper)]"
              >
                {home.primaryCta}
              </Link>
              <button
                type="button"
                disabled
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-fg px-6 whitespace-nowrap text-lg font-extrabold disabled:cursor-not-allowed disabled:opacity-70"
              >
                {home.secondaryCta}
                <span className="text-sm font-semibold">· {home.soon}</span>
              </button>
            </div>
            <p className="font-hand text-lg leading-[2.2] text-muted">{home.signOff}</p>
          </div>
          <div className="drift flex justify-center md:justify-end">
            <HeroArt label={home.art.label} letterTo={home.art.to} letterBody={home.art.body} />
          </div>
        </section>

        <section aria-labelledby="send" className="flex flex-col gap-8">
          <h2 id="send" className="text-3xl md:text-4xl">
            {home.experiencesHeading}
          </h2>
          <ul className="grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-8">
            {EXPERIENCES.map(({ key, tone, tilt }) => (
              <li key={key}>
                <StampCard
                  title={home.experiences[key].title}
                  body={home.experiences[key].body}
                  tone={tone}
                  tilt={tilt}
                />
              </li>
            ))}
          </ul>
        </section>

        <section className="letter-sheet flex flex-col gap-3 rounded-sm py-8 pr-6 pl-12 md:max-w-3xl md:py-10 md:pl-16">
          <h2 className="text-3xl md:text-4xl">{home.gamesHeading}</h2>
          <p className="text-lg leading-[2.25rem] text-muted">{home.gamesBody}</p>
        </section>

        <p className="text-sm text-muted">{home.adultsOnly}</p>
      </main>
      <BottomNav t={t.nav} current="home" />
    </>
  );
}
