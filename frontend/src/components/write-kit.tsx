"use client";

import Link from "next/link";
import { useState } from "react";

import { type LetterContent, type LetterTheme, PAPER } from "@/components/LetterCard";
import { SaveLetter } from "@/components/SaveLetter";
import { getMessages } from "@/i18n";

// Pieces every "write" form shares: love notes, date invitations and the types still to come.

const t = getMessages().write;

export const LIMITS = { name: 60, title: 60 };
export const THEMES: LetterTheme[] = ["cream", "kraft", "rose"];

export const input =
  "min-h-12 w-full rounded-md border-2 border-fg bg-surface px-3 text-base text-fg placeholder:text-muted";
export const label = "flex flex-col gap-1 text-sm font-semibold";
export const hint = "text-sm font-normal text-muted";
export const legend = "mb-3 text-2xl";

/** Lagos is UTC+1 all year (no daylight saving). */
export function lagosIso(local: string): string | null {
  return local ? `${local}:00+01:00` : null;
}

// Drafts live on this device only, so nothing is lost while they log in.
export function loadDraft<T extends object>(key: string, empty: T): T {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? { ...empty, ...(JSON.parse(saved) as Partial<T>) } : empty;
  } catch {
    return empty;
  }
}

export function saveDraft<T>(key: string, draft: T | null): void {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    // Private browsing or storage blocked: the form still works, just without saving.
  }
}

/** "Love note · Date invitation": which kind of letter this form makes. */
export function TypeSwitch({ current }: { current: "love_note" | "date_invite" }) {
  const items = [
    { key: "love_note", href: "/write", text: t.kinds.love_note },
    { key: "date_invite", href: "/write/date", text: t.kinds.date_invite },
  ] as const;
  return (
    <nav aria-label={t.kindsLabel} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={current === item.key ? "page" : undefined}
          className={`inline-flex min-h-12 items-center rounded-full border-2 px-4 font-bold no-underline ${
            current === item.key ? "border-fg bg-fg text-bg" : "border-line"
          }`}
        >
          {item.text}
        </Link>
      ))}
    </nav>
  );
}

export type Who = {
  senderName: string;
  recipientName: string;
  recipientTitle: string;
  recipientEmail: string;
};

export function WhoFields({ draft, update }: { draft: Who; update: (changes: Partial<Who>) => void }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className={legend} style={{ fontFamily: "var(--font-heading)" }}>
        {t.whoHeading}
      </legend>
      <label className={label}>
        {t.senderLabel}
        <input className={input} name="sender_name" autoComplete="given-name" required
          maxLength={LIMITS.name} value={draft.senderName}
          onChange={(e) => update({ senderName: e.target.value })} />
        <span className={hint}>{t.senderHint}</span>
      </label>
      <label className={label}>
        {t.recipientLabel}
        <input className={input} name="recipient_name" required maxLength={LIMITS.name}
          value={draft.recipientName} onChange={(e) => update({ recipientName: e.target.value })} />
      </label>
      <label className={label}>
        {t.titleLabel}
        <input className={input} name="recipient_title" maxLength={LIMITS.title}
          value={draft.recipientTitle} onChange={(e) => update({ recipientTitle: e.target.value })} />
        <span className={hint}>{t.titleHint}</span>
      </label>
      <label className={label}>
        {t.emailLabel}
        <input className={input} type="email" name="recipient_email" autoComplete="off"
          inputMode="email" maxLength={254} value={draft.recipientEmail}
          onChange={(e) => update({ recipientEmail: e.target.value })} />
        <span className={hint}>{t.emailHint}</span>
      </label>
    </fieldset>
  );
}

export type Look = { theme: LetterTheme; opensAt: string };

export function LookFields({ draft, update }: { draft: Look; update: (changes: Partial<Look>) => void }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className={legend} style={{ fontFamily: "var(--font-heading)" }}>
        {t.lookHeading}
      </legend>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">{t.themeLabel}</span>
        <div className="flex gap-3" role="radiogroup" aria-label={t.themeLabel}>
          {THEMES.map((theme) => (
            <label key={theme} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-md border-2 px-3 font-bold ${
              draft.theme === theme ? "border-fg" : "border-line"}`}>
              <input type="radio" name="theme" value={theme} className="sr-only"
                checked={draft.theme === theme} onChange={() => update({ theme })} />
              <span aria-hidden="true" className="h-6 w-6 rounded-full border-2 border-fg"
                style={{ backgroundColor: PAPER[theme] }} />
              {t.themes[theme]}
            </label>
          ))}
        </div>
      </div>
      <label className={label}>
        {t.scheduleLabel}
        <input className={input} type="datetime-local" name="opens_at" value={draft.opensAt}
          onChange={(e) => update({ opensAt: e.target.value })} />
        <span className={hint}>{t.scheduleHint}</span>
      </label>
    </fieldset>
  );
}

export type Sealed = {
  url: string;
  opens_at: string | null;
  email_status: "scheduled" | "blocked" | null;
  letter: LetterContent;
  email: string;
};

export function SealedPanel({
  sealed,
  onAnother,
  whatsappText = t.whatsappText,
  anotherText = t.writeAnother,
}: {
  sealed: Sealed;
  onAnother: () => void;
  whatsappText?: string;
  anotherText?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${whatsappText} ${sealed.url}`)}`;
  const path = new URL(sealed.url).pathname;
  const when = sealed.opens_at
    ? new Date(sealed.opens_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })
    : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(sealed.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="letter-sheet mx-auto flex max-w-2xl flex-col gap-5 rounded-sm py-10 pr-6 pl-12 md:pr-12 md:pl-16" aria-live="polite">
      <h1 className="text-4xl md:text-5xl">{t.sealedTitle}</h1>
      <p className="text-lg text-muted">{t.sealedLead}</p>
      {when && <p className="font-semibold">{t.sealedUntil.replace("{when}", when)}</p>}
      {sealed.email_status === "scheduled" && (
        <p className="font-semibold">
          {(sealed.opens_at ? t.emailWhenOpens : t.emailScheduled).replace("{email}", sealed.email)}
        </p>
      )}
      {sealed.email_status === "blocked" && <p className="font-semibold">{t.emailBlocked}</p>}
      <p className="rounded-md border-2 border-dashed border-line bg-surface p-3 text-sm break-all">{sealed.url}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button type="button" onClick={copy}
          className="min-h-12 rounded-lg border-2 border-fg px-5 font-bold">
          {copied ? t.copied : t.copyLink}
        </button>
        <a href={whatsapp} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-stamp px-5 font-extrabold text-paper shadow-[3px_3px_0_var(--color-ink)]">
          {t.whatsapp}
        </a>
        {canShare && (
          <button type="button" className="min-h-12 rounded-lg border-2 border-fg px-5 font-bold"
            onClick={() => navigator.share({ title: "Dearlly", text: whatsappText, url: sealed.url }).catch(() => undefined)}>
            {t.share}
          </button>
        )}
      </div>
      <SaveLetter letter={sealed.letter} />
      <p className="text-sm text-muted">{t.trackIt}</p>
      <div className="flex flex-wrap gap-4 text-sm font-bold underline">
        <Link href={path}>{t.viewLetter}</Link>
        <button type="button" className="underline" onClick={onAnother}>{anotherText}</button>
      </div>
    </section>
  );
}
