/**
 * Translation files. All user-facing text lives in src/i18n/messages/<locale>.json.
 * A new language (for example Nigerian Pidgin, "pcm") is a new JSON file with the same shape:
 * the Messages type makes the build fail if a key is missing.
 */

import en from "./messages/en.json";

export type Messages = typeof en;

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

const catalogs: Record<Locale, Messages> = { en };

export function getMessages(locale: Locale = defaultLocale): Messages {
  return catalogs[locale];
}
