"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { draftPhoto, NO_PHOTO, PhotoField } from "@/components/PhotoField";
import { LetterCard, type LetterContent, type LetterTheme } from "@/components/LetterCard";
import {
  input,
  label,
  legend,
  lagosIso,
  loadDraft,
  LookFields,
  SealedPanel,
  type Sealed,
  saveDraft,
  TypeSwitch,
  WhoFields,
} from "@/components/write-kit";
import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";

const t = getMessages().write;

const DRAFT_KEY = "dearlly:draft:love_note";
// Same limits as the server (backend/config/experience_types.yaml); the server checks again.
const LIMITS = { quoteTitle: 80, quoteText: 600 };
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
  photoId: string;
  photoUrl: string;
  photoSmallUrl: string;
  photoWidth: number;
  photoHeight: number;
  opensAt: string; // datetime-local value, WAT
  secret: boolean; // secret admirer: they see "A secret admirer" until the name is revealed
};

type Quote = { key: string; mood: Mood; title: string; text: string };

const EMPTY: Draft = {
  senderName: "",
  recipientName: "",
  recipientTitle: "",
  recipientEmail: "",
  quoteTitle: "",
  quoteText: "",
  theme: "cream",
  ...NO_PHOTO,
  secret: false,
  opensAt: "",
};

function asLetter(draft: Draft): LetterContent {
  return {
    // The preview shows what they'll see.
    senderName: draft.secret ? t.secretName : draft.senderName,
    recipientName: draft.recipientName,
    recipientTitle: draft.recipientTitle,
    quoteTitle: draft.quoteTitle,
    quoteText: draft.quoteText,
    theme: draft.theme,
    photo: draftPhoto(draft),
  };
}

export function WriteLetter({
  loggedIn = false,
  start,
}: {
  loggedIn?: boolean;
  /** A quote chosen on the quotes page: it replaces the message in their draft. */
  start?: Pick<Draft, "quoteTitle" | "quoteText">;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = loadDraft(DRAFT_KEY, EMPTY);
    if (!start) return saved;
    const next = { ...saved, ...start };
    saveDraft(DRAFT_KEY, next);
    return next;
  });

  // The quote is in the draft now: drop it from the address, so a refresh keeps their edits.
  useEffect(() => {
    if (start) router.replace("/write", { scroll: false });
  }, [start, router]);
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
      saveDraft(DRAFT_KEY, next);
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
          content: {
            quote_title: draft.quoteTitle || null,
            quote_text: draft.quoteText,
            photo: draft.photoId || null,
          },
          opens_at: lagosIso(draft.opensAt),
          recipient_email: draft.recipientEmail.trim() || null,
          secret: draft.secret,
        },
      });
      saveDraft(DRAFT_KEY, null);
      setSealed({ ...result, secret: draft.secret, letter: asLetter(draft), email: draft.recipientEmail.trim() });
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
    return (
      <SealedPanel sealed={sealed} onAnother={() => { setDraft(EMPTY); setSealed(null); }}
        note={sealed.secret ? t.secretSealed : undefined}
        whatsappText={sealed.secret ? t.secretWhatsapp : undefined} />
    );
  }

  const preview = <LetterCard placeholder={t.placeholder} letter={asLetter(draft)} />;

  return (
    <form onSubmit={seal} className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <TypeSwitch current="love_note" />
          <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
          <p className="text-lg text-muted">{t.lead}</p>
        </header>

        <WhoFields draft={draft} update={update} />

        <label className="flex min-h-12 items-start gap-3 rounded-md border-2 border-dashed border-line p-3">
          <input type="checkbox" name="secret" className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-stamp)]"
            checked={draft.secret}
            // No photos on secret admirer letters: one already added is taken off.
            onChange={(e) => update(e.target.checked ? { secret: true, ...NO_PHOTO } : { secret: false })} />
          <span>
            <span className="block font-bold">{t.secretLabel}</span>
            <span className="block text-sm text-muted">{t.secretHint}</span>
          </span>
        </label>

        <fieldset className="flex flex-col gap-4">
          <legend className={legend} style={{ fontFamily: "var(--font-heading)" }}>
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

        {!draft.secret && <PhotoField value={draft} onChange={update} loggedIn={loggedIn} next="/write" />}

        <LookFields draft={draft} update={update} />

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
