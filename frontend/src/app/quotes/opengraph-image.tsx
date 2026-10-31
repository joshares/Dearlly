import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// Shared links to the love note ideas.
const og = getMessages().og;

export const alt = og.quotes.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({ ...og.quotes, site: og.site });
}
