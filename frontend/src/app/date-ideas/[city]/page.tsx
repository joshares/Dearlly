import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DateIdeas } from "@/app/date-ideas/page";
import { BottomNav } from "@/components/BottomNav";
import { CityList, DateCta, fill, PlaceGroups } from "@/components/DateIdeas";
import type { City, Place } from "@/components/PlacePicker";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { serverGet } from "@/lib/server-api";
import { seemsLoggedIn } from "@/lib/session";
import { shareCard } from "@/lib/site";

const t = getMessages();
const d = t.dateIdeas;

type Params = { params: Promise<{ city: string }> };

/** null: the list couldn't be loaded; city undefined: we don't cover that city. */
async function findCity(key: string): Promise<{ cities: City[]; city: City | undefined } | null> {
  const cities = await serverGet<City[]>("/cities");
  return cities && { cities, city: cities.find((c) => c.key === key) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await findCity((await params).city);
  if (!found) return { title: d.metaTitle };
  const { city } = found;
  if (!city) return { title: t.notFound.metaTitle };
  const title = fill(d.cityMetaTitle, { city: city.name });
  const description = fill(d.cityMetaDescription, { city: city.name, count: city.place_count });
  return {
    title,
    description,
    alternates: { canonical: `/date-ideas/${city.key}` },
    openGraph: shareCard(title, description),
  };
}

export default async function CityDateIdeasPage({ params }: Params) {
  const key = (await params).city;
  const [loggedIn, found] = await Promise.all([seemsLoggedIn(), findCity(key)]);
  // A city we don't cover is a "returned letter". If the list couldn't load, the page says so.
  if (!found) return <DateIdeas loggedIn={loggedIn} cities={null} />;
  if (!found.city) notFound();
  const places = await serverGet<Place[]>(`/cities/${encodeURIComponent(found.city.key)}/places`);
  return <CityDateIdeas loggedIn={loggedIn} city={found.city} cities={found.cities} places={places} />;
}

export function CityDateIdeas({
  loggedIn,
  city,
  cities,
  places,
}: {
  loggedIn: boolean;
  city: City;
  cities: City[];
  places: Place[] | null;
}) {
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <header className="flex max-w-3xl flex-col gap-4">
          <Link href="/date-ideas" className="inline-flex min-h-12 items-center self-start text-sm font-bold underline">
            {d.allCities}
          </Link>
          <h1 className="text-[2.6rem] leading-[1.05] md:text-6xl">{fill(d.cityTitle, { city: city.name })}</h1>
          <p className="text-lg leading-[1.8] text-muted">{d.cityLead}</p>
          <p className="text-sm text-muted">{d.checkFirst}</p>
        </header>
        {places === null ? (
          <p role="alert" className="font-semibold">{d.failed}</p>
        ) : (
          <PlaceGroups city={city.key} places={places} />
        )}
        {cities.length > 1 && (
          <section aria-labelledby="other-cities" className="flex flex-col gap-4">
            <h2 id="other-cities" className="text-2xl">{d.otherCities}</h2>
            <CityList cities={cities} current={city.key} />
          </section>
        )}
        <DateCta />
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
