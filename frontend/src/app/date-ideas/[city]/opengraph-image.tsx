import type { City } from "@/components/PlacePicker";
import { fill } from "@/components/DateIdeas";
import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";
import { serverGet } from "@/lib/server-api";

// Shared links to one city's date ideas: its name and how many places we list.
const og = getMessages().og;

export const alt = og.dateIdeas.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default async function Image({ params }: { params: Promise<{ city: string }> }) {
  const key = (await params).city;
  const city = (await serverGet<City[]>("/cities"))?.find((c) => c.key === key);
  if (!city) return ogImage({ ...og.dateIdeas, site: og.site });
  return ogImage({
    kicker: og.city.kicker,
    title: fill(og.city.title, { city: city.name }),
    line: fill(og.city.line, { count: city.place_count }),
    site: og.site,
  });
}
