"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { LetterCard, type LetterContent, type LetterTheme, PAPER } from "@/components/LetterCard";
import { SaveLetter } from "@/components/SaveLetter";
import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";

const t = getMessages().write;

const DRAFT_KEY = "dearlly:draft:love_note";
// Same limits as the server (backend/config/experience_types.yaml); the server checks again.
const LIMITS = { name: 60, title: 60, quoteTitle: 80, quoteText: 600 };
const THEMES: LetterTheme[] = ["cream", "kraft", "rose"];
type Mood = keyof typeof t.moods;
const MOODS = Object.keys(t.moods) as Mood[];

type Draft = {
  senderName: string;
  recipientName: string;
  recipientTitle: string;
  recipientEmail: string;
  quoteTitle: string;
  quoteText: string;
  theme: LetterTheme;
  opensAt: string; // datetime-local value, Lagos time
};

type Quote = { key: string; mood: Mood; title: string; text: string };
type Sealed = {
  url: string;
  opens_at: string | null;
  email_status: "scheduled" | "blocked" | null;
  letter: LetterContent;
  email: string;
};

const EMPTY: Draft = {
  senderName: "",
  recipientName: "",
  recipientTitle: "",
  recipientEmail: "",
  quoteTitle: "",
  quoteText: "",
  theme: "cream",
  opensAt: "",
};

// The draft lives on this device only, so nothing is lost while they log in.
function loadDraft(): Draft {
  try {
    const saved = window.localStorage.getItem(DRAFT_KEY);
    return saved ? { ...EMPTY, ...(JSON.parse(saved) as Partial<Draft>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveDraft(draft: Draft | null): void {
  try {
    if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private browsing or storage blocked: the form still works, just without saving.
  }
}

function asLetter(draft: Draft): LetterContent {
  return {
    senderName: draft.senderName,
    recipientName: draft.recipientName,
    recipientTitle: draft.recipientTitle,
    quoteTitle: draft.quoteTitle,
    quoteText: draft.quoteText,
    theme: draft.theme,
  };
}

/** Lagos is UTC+1 all year (no daylight saving). */
function lagosIso(local: string): string | null {
  return local ? `${local}:00+01:00` : null;
}

const input =
  "min-h-12 w-full rounded-md border-2 border-fg bg-surface px-3 text-base text-fg placeholder:text-muted";
const label = "flex flex-col gap-1 text-sm font-semibold";
const hint = "text-sm font-normal text-muted";

export function WriteLetter({ loggedIn = false }: { loggedIn?: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [mood, setMood] = useState<Mood | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);

  useEffect(() => {
    api<Quote[]>("/quotes")
      .then(setQuotes)
      .catch(() => setQuotes([]));
  }, []);

  const update = (changes: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...changes };
      saveDraft(next);
      return next;
    });
  };

  const shownQuotes = useMemo(
    () => (mood === "all" ? quotes : quotes.filter((q) => q.mood === mood)),
    [quotes, mood],
  );

  const ready =
    draft.senderName.trim() !== "" &&
    draft.recipientName.trim() !== "" &&
    draft.quoteText.trim() !== "";

  async function seal(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<Omit<Sealed, "letter" | "email">>("/experiences", {
        method: "POST",
        body: {
          type: "love_note",
          sender_name: draft.senderName,
          recipient_name: draft.recipientName,
          recipient_title: draft.recipientTitle || null,
          theme: draft.theme,
          content: { quote_title: draft.quoteTitle || null, quote_text: draft.quoteText },
          opens_at: lagosIso(draft.opensAt),
          recipient_email: draft.recipientEmail.trim() || null,
        },
      });
      saveDraft(null);
      setSealed({ ...result, letter: asLetter(draft), email: draft.recipientEmail.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The account step: their draft is saved; they come straight back here.
        router.push(`/login?next=${encodeURIComponent("/write")}`);
        return;
      }
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sealed) {
    return <SealedPanel sealed={sealed} onAnother={() => { setDraft(EMPTY); setSealed(null); }} />;
  }

  const preview = <LetterCard placeholder={t.placeholder} letter={asLetter(draft)} />;

  return (
    <form onSubmit={seal} className="grid gap-10 md:grid-cols-[1fr_1fr] md:gap-12">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
          <p className="text-lg text-muted">{t.lead}</p>
        </header>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-2xl" style={{ fontFamily: "var(--font-heading)" }}>
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

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-2xl" style={{ fontFamily: "var(--font-heading)" }}>
            {t.wordsHeading}
          </legend>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{t.pickQuote}</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t.pickQuote}>
              {(["all", ...MOODS] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mood === m} onClick={() => setMood(m)}
                  className={`min-h-10 rounded-full border-2 px-3 text-sm font-bold ${
                    mood === m ? "border-fg bg-fg text-bg" : "border-line"
                  }`}>
                  {m === "all" ? t.allMoods : t.moods[m]}
                </button>
              ))}
            </div>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-md border-2 border-dashed border-line p-2">
              {shownQuotes.map((q) => (
                <li key={q.key} className="flex items-start justify-between gap-3 rounded bg-surface p-3">
                  <span className="text-sm">
                    <strong className="block">{q.title}</strong>
                    {q.text}
                  </span>
                  <button type="button" className="min-h-10 shrink-0 rounded-md border-2 border-fg px-3 text-sm font-bold"
                    onClick={() => update({ quoteTitle: q.title, quoteText: q.text })}>
                    {t.useQuote}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <label className={label}>
            {t.quoteTitleLabel}
            <input className={input} name="quote_title" maxLength={LIMITS.quoteTitle}
              value={draft.quoteTitle} onChange={(e) => update({ quoteTitle: e.target.value })} />
          </label>
          <label className={label}>
            <span className="flex justify-between">
              {t.quoteTextLabel}
              <span className="font-normal text-muted">
                {t.characters.replace("{count}", String(draft.quoteText.length)).replace("{max}", String(LIMITS.quoteText))}
              </span>
            </span>
            <textarea className={`${input} min-h-40 py-2 leading-relaxed`} name="quote_text" required
              maxLength={LIMITS.quoteText} value={draft.quoteText}
              onChange={(e) => update({ quoteText: e.target.value })} />
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-2xl" style={{ fontFamily: "var(--font-heading)" }}>
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

        <div className="md:hidden">
          <h2 className="mb-4 text-2xl">{t.previewHeading}</h2>
          {preview}
        </div>

        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !ready}
            className="min-h-14 rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-50 disabled:shadow-none">
            {busy ? t.sealing : t.seal}
          </button>
          {!loggedIn && <p className="text-sm text-muted">{t.sealNeedsAccount}</p>}
        </div>
      </div>

      <aside className="hidden md:block">
        <div className="sticky top-8 flex flex-col gap-4">
          <h2 className="text-2xl">{t.previewHeading}</h2>
          {preview}
        </div>
      </aside>
    </form>
  );
}

function SealedPanel({ sealed, onAnother }: { sealed: Sealed; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${t.whatsappText} ${sealed.url}`)}`;
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
            onClick={() => navigator.share({ title: "Dearlly", text: t.whatsappText, url: sealed.url }).catch(() => undefined)}>
            {t.share}
          </button>
        )}
      </div>
      <SaveLetter letter={sealed.letter} />
      <p className="text-sm text-muted">{t.trackIt}</p>
      <div className="flex flex-wrap gap-4 text-sm font-bold underline">
        <Link href={path}>{t.viewLetter}</Link>
        <button type="button" className="underline" onClick={onAnother}>{t.writeAnother}</button>
      </div>
    </section>
  );
}
