import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// Shared links to the games library.
const og = getMessages().og;

export const alt = og.games.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({ ...og.games, site: og.site });
}
