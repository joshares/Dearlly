import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import { CityList, DateCta } from "@/components/DateIdeas";
import type { City } from "@/components/PlacePicker";
import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { serverGet } from "@/lib/server-api";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = {
  title: t.dateIdeas.metaTitle,
  description: t.dateIdeas.metaDescription,
  alternates: { canonical: "/date-ideas" },
};

export default async function DateIdeasPage() {
  const [loggedIn, cities] = await Promise.all([seemsLoggedIn(), serverGet<City[]>("/cities")]);
  return <DateIdeas loggedIn={loggedIn} cities={cities} />;
}

/** Public, indexable: pick a city to see its date places. */
export function DateIdeas({ loggedIn, cities }: { loggedIn: boolean; cities: City[] | null }) {
  const d = t.dateIdeas;
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <header className="flex flex-col gap-4">
          <h1 className="text-[2.6rem] leading-[1.05] md:text-6xl">{d.title}</h1>
          <p className="text-lg leading-[1.8] text-muted">{d.lead}</p>
        </header>
        <section aria-labelledby="cities" className="flex flex-col gap-4">
          <h2 id="cities" className="text-2xl">{d.citiesLabel}</h2>
          {cities === null ? <p role="alert" className="font-semibold">{d.failed}</p> : <CityList cities={cities} />}
        </section>
        <DateCta />
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
