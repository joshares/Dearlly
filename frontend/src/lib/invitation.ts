import type { LetterContent, LetterTheme } from "@/components/LetterCard";
import { getMessages } from "@/i18n";
import { lagosDateTime } from "@/lib/dates";

const t = getMessages().date;

/** What a date invitation stores (backend/config/experience_types.yaml, date_invite). */
export type DateContent = {
  message: string;
  city: string;
  place_key?: string | null;
  place_name?: string | null;
  place_area?: string | null;
  place_address?: string | null;
  date_at: string;
  note?: string | null;
};

export function placeLine(c: Pick<DateContent, "place_name" | "place_area" | "place_address">): string {
  const where = [c.place_area, c.place_address].filter(Boolean).join(" · ");
  return [c.place_name, where].filter(Boolean).join("\n");
}

/** The invitation drawn as a letter: the message, then Where / When / Note. */
export function dateLetter(
  c: Partial<DateContent>,
  people: { senderName: string; recipientName: string; recipientTitle?: string | null; theme: LetterTheme },
): LetterContent {
  const details: { label: string; value: string }[] = [];
  const where = placeLine(c);
  if (where) details.push({ label: t.where, value: where });
  if (c.date_at && !Number.isNaN(Date.parse(c.date_at))) {
    details.push({ label: t.when, value: `${lagosDateTime(c.date_at)} ${t.timeZone}` });
  }
  if (c.note?.trim()) details.push({ label: t.note, value: c.note.trim() });
  return { ...people, quoteTitle: t.cardTitle, quoteText: c.message ?? "", details };
}

/** A Google Maps search for the place (opens their maps app on a phone). */
export function directionsUrl(c: DateContent, cityName: string): string {
  const query = [c.place_name, c.place_address, c.place_area, cityName].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
