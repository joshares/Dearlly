import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// The same picture for every game link: the game itself is never read here.
const og = getMessages().og;

export const alt = og.play.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({ ...og.play, site: og.site });
}
