import Link from "next/link";

import type { City, Place } from "@/components/PlacePicker";
import { getMessages } from "@/i18n";

const t = getMessages();
const d = t.dateIdeas;

type Vibe = keyof typeof t.date.vibes;
const VIBES = Object.keys(t.date.vibes) as Vibe[];

export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

const button =
  "inline-flex min-h-12 items-center justify-center rounded-lg border-2 border-fg px-4 font-extrabold no-underline";

/** Cities with their place counts, as cards. */
export function CityList({ cities, current }: { cities: City[]; current?: string }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {cities
        .filter((c) => c.key !== current)
        .map((city) => (
          <li key={city.key}>
            <Link href={`/date-ideas/${city.key}`}
              className="letter-sheet flex min-h-20 flex-col gap-1 rounded-sm py-5 pr-5 pl-10 no-underline">
              <span className="font-heading text-2xl">{city.name}</span>
              <span className="text-muted">{fill(d.placeCount, { count: city.place_count })}</span>
            </Link>
          </li>
        ))}
    </ul>
  );
}

/**
 * Every place in a city, once each, under its main kind of date (its first vibe), with the
 * guides that recommend it and a tap to invite someone there.
 */
export function PlaceGroups({ city, places }: { city: string; places: Place[] }) {
  const groups = VIBES.map((vibe) => ({ vibe, items: places.filter((p) => p.vibes[0] === vibe) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <>
      <nav aria-label={d.vibesLabel} className="flex flex-wrap gap-2">
        {groups.map(({ vibe }) => (
          <a key={vibe} href={`#${vibe}`}
            className="inline-flex min-h-12 items-center rounded-full border-2 border-line px-4 text-sm font-bold no-underline">
            {t.date.vibes[vibe]}
          </a>
        ))}
      </nav>
      {groups.map(({ vibe, items }) => (
        <section key={vibe} id={vibe} aria-labelledby={`${vibe}-h`} className="flex scroll-mt-6 flex-col gap-5">
          <h2 id={`${vibe}-h`} className="text-3xl md:text-4xl">{t.date.vibes[vibe]}</h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2 lg:grid-cols-3">
            {items.map((place) => (
              <PlaceCard key={place.key} city={city} place={place} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function PlaceCard({ city, place }: { city: string; place: Place }) {
  const count = place.sources.length;
  return (
    <li className="letter-sheet flex min-w-0 flex-col gap-3 rounded-sm py-6 pr-5 pl-10">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl">{place.name}</h3>
        <p className="text-muted">{place.area}</p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label={t.date.vibesLabel}>
        {place.vibes.map((v) => (
          <li key={v} className="rounded-full border border-line px-2.5 py-0.5 text-xs font-bold">
            {t.date.vibes[v]}
          </li>
        ))}
      </ul>
      {place.price_note && <p className="text-sm text-muted">{place.price_note}</p>}
      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold">{count === 1 ? t.date.featuredOne : fill(t.date.featuredMany, { count })}</p>
        <ul className="flex flex-col gap-1">
          {place.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="break-words underline">
                {s.rank ? fill(t.date.rankIn, { rank: s.rank, publisher: s.publisher }) : fill(t.date.listedIn, { publisher: s.publisher })}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <Link href={`/write/date?city=${encodeURIComponent(city)}&place=${encodeURIComponent(place.key)}`}
        className={`${button} mt-auto self-start`}>
        {d.invite}
      </Link>
    </li>
  );
}

export function DateCta() {
  return (
    <section className="flex flex-col gap-3 border-t-2 border-dashed border-line pt-8">
      <h2 className="text-3xl">{d.ctaHeading}</h2>
      <p className="text-lg leading-[1.8] text-muted">{d.ctaBody}</p>
      <Link href="/write/date"
        className="inline-flex min-h-14 items-center justify-center self-start rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper no-underline shadow-[4px_4px_0_var(--color-ink)]">
        {d.cta}
      </Link>
    </section>
  );
}
