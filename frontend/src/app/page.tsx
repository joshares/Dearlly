import { BottomNav } from "@/components/BottomNav";
import { Envelope } from "@/components/Envelope";
import { getMessages } from "@/i18n";

const EXPERIENCES = ["loveNote", "date", "vacation", "gift"] as const;
const TILTS = ["-rotate-2", "rotate-1", "rotate-2", "-rotate-1"];

export default function HomePage() {
  const t = getMessages();
  const home = t.home;

  return (
    <>
      <main className="mx-auto flex max-w-lg flex-col gap-10 px-5 pt-8 pb-32">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-heading text-3xl">{t.brand.name}</p>
          <p className="rounded-full border-2 border-stamp px-3 py-1 text-xs font-bold tracking-wide text-accent-text uppercase">
            {home.badge}
          </p>
        </header>

        <section className="flex flex-col items-center gap-6 text-center">
          <Envelope label={t.envelope.label} />
          <p className="font-hand text-lg text-muted">{t.brand.tagline}</p>
          <h1 className="text-4xl leading-tight">{home.title}</h1>
          <p className="text-base leading-relaxed text-muted">{home.lead}</p>
          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              disabled
              className="min-h-12 rounded-md bg-stamp px-5 text-base font-bold text-paper shadow-[3px_3px_0_var(--color-ink)] disabled:cursor-not-allowed"
            >
              {home.primaryCta} · <span className="font-normal">{home.soon}</span>
            </button>
            <button
              type="button"
              disabled
              className="min-h-12 rounded-md border-2 border-fg px-5 text-base font-bold disabled:cursor-not-allowed"
            >
              {home.secondaryCta} · <span className="font-normal">{home.soon}</span>
            </button>
          </div>
        </section>

        <section aria-labelledby="experiences" className="flex flex-col gap-4">
          <h2 id="experiences" className="text-2xl">
            {home.experiencesHeading}
          </h2>
          <ul className="grid grid-cols-2 gap-4">
            {EXPERIENCES.map((key, index) => (
              <li key={key} className={`stamp-edge bg-kraft ${TILTS[index]}`}>
                <div className="flex h-full flex-col gap-1 border-2 border-ink bg-paper p-3 text-ink">
                  <h3 className="text-lg leading-snug">{home.experiences[key].title}</h3>
                  <p className="text-sm leading-snug">{home.experiences[key].body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border-2 border-dashed border-line p-5">
          <h2 className="text-2xl">{home.gamesHeading}</h2>
          <p className="mt-2 text-muted">{home.gamesBody}</p>
        </section>

        <p className="text-center text-sm text-muted">{home.adultsOnly}</p>
      </main>
      <BottomNav t={t.nav} current="home" />
    </>
  );
}
