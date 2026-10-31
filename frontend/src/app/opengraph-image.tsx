import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// The picture for any shared Dearlly link that doesn't have its own.
const og = getMessages().og;

export const alt = og.home.alt;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogImage({ ...og.home, site: og.site });
}
