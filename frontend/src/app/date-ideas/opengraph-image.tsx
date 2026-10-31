import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// Shared links to date ideas (each city page has its own).
const og = getMessages().og;

export const alt = og.dateIdeas.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({ ...og.dateIdeas, site: og.site });
}
