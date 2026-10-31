import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// The same sealed envelope for every letter: the link's secret (token) is never read here,
// so a preview shows nothing of who it's from, who it's for, or what it says.
const og = getMessages().og;

export const alt = og.letter.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({ ...og.letter, site: og.site });
}
