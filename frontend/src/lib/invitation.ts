import type { LetterContent } from "@/components/LetterCard";
import { getMessages } from "@/i18n";
import { lagosDateTime } from "@/lib/dates";

const t = getMessages().date;

/** Who it's from and to, the paper, and the photo (if any): shared by every letter type. */
type People = Pick<LetterContent, "senderName" | "recipientName" | "recipientTitle" | "theme" | "photo">;

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
  people: People,
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

const v = getMessages().vacation;

/** What a vacation invitation stores (backend/config/experience_types.yaml, vacation_invite). */
export type VacationContent = {
  message: string;
  destination: string;
  start_date: string; // YYYY-MM-DD, a day in WAT
  end_date: string;
  packing?: string | null;
  note?: string | null;
};

const DAY_MS = 86_400_000;

function day(iso: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : null;
}

/** "12–16 Dec 2026 · 4 nights" (dates are whole days, so no time zone is shown). */
export function tripDates(start?: string, end?: string): string {
  const from = start ? day(start) : null;
  const to = end ? day(end) : from;
  if (!from || !to) return "";
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
  const nights = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const length = nights <= 0 ? v.dayTrip : nights === 1 ? v.oneNight : v.nights.replace("{count}", String(nights));
  let range: string;
  if (nights <= 0) range = fmt(from, { day: "numeric", month: "short", year: "numeric" });
  else if (from.getUTCFullYear() !== to.getUTCFullYear())
    range = `${fmt(from, { day: "numeric", month: "short", year: "numeric" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
  else if (from.getUTCMonth() !== to.getUTCMonth())
    range = `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
  else range = `${from.getUTCDate()}–${fmt(to, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${range} · ${length}`;
}

/** The trip drawn as a letter: the message, then Where / When / Pack / Note. */
export function vacationLetter(
  c: Partial<VacationContent>,
  people: People,
): LetterContent {
  const details: { label: string; value: string }[] = [];
  if (c.destination?.trim()) details.push({ label: v.where, value: c.destination.trim() });
  const when = tripDates(c.start_date, c.end_date);
  if (when) details.push({ label: v.dates, value: when });
  if (c.packing?.trim()) details.push({ label: v.packing, value: c.packing.trim() });
  if (c.note?.trim()) details.push({ label: v.note, value: c.note.trim() });
  return { ...people, quoteTitle: v.cardTitle, quoteText: c.message ?? "", details };
}

const g = getMessages().gift;

/** What a gift reveal stores (backend/config/experience_types.yaml, gift_reveal). */
export type GiftContent = {
  message: string;
  gift: string;
  hint?: string | null;
  note?: string | null;
};

/** The gift letter. The gift (and its photo) sit under the scratch-off stamp, so on the letter
 *  they only appear (for saving as a picture or PDF) once revealed. `giftPhoto` is for the stamp. */
export function giftLetter(
  c: Partial<GiftContent>,
  people: People,
  withGift = false,
): LetterContent {
  const details: { label: string; value: string }[] = [];
  if (withGift && c.gift?.trim()) details.push({ label: g.giftDetail, value: c.gift.trim() });
  if (c.note?.trim()) details.push({ label: g.note, value: c.note.trim() });
  return {
    ...people,
    photo: withGift ? people.photo : null,
    giftPhoto: people.photo ?? null,
    quoteTitle: g.cardTitle,
    quoteText: c.message ?? "",
    details,
  };
}
