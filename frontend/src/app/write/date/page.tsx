import type { Metadata } from "next";

import { BottomNav } from "@/components/BottomNav";
import type { Place } from "@/components/PlacePicker";
import { SiteHeader } from "@/components/SiteHeader";
import { WriteDateClient } from "@/components/WriteLetterClient";
import { getMessages } from "@/i18n";
import { serverGet } from "@/lib/server-api";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.date.metaTitle };

type Search = { city?: string | string[]; place?: string | string[] };

/** /write/date?city=&place= (from the date ideas pages): the form starts with that place chosen. */
export default async function WriteDatePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { city, place } = await searchParams;
  const asked = typeof city === "string" && typeof place === "string" && /^[a-z0-9_-]+$/.test(city);
  const [loggedIn, places] = await Promise.all([
    seemsLoggedIn(),
    asked ? serverGet<Place[]>(`/cities/${city}/places`) : null,
  ]);
  const chosen = places?.find((p) => p.key === place);
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <WriteDateClient loggedIn={loggedIn}
          start={chosen && {
            city: city as string,
            placeKey: chosen.key,
            placeName: chosen.name,
            placeArea: chosen.area,
            placeAddress: chosen.address ?? "",
          }} />
      </main>
      <BottomNav t={t.nav} current="create" />
    </>
  );
}
