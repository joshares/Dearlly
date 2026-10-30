"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { LetterCard, type LetterTheme } from "@/components/LetterCard";
import { PlacePicker, type PlaceChoice } from "@/components/PlacePicker";
import {
  hint,
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
import { dateLetter } from "@/lib/invitation";

const t = getMessages().date;
const w = getMessages().write;

const DRAFT_KEY = "dearlly:draft:date_invite";
// Same limits as the server (backend/config/experience_types.yaml); the server checks again.
const LIMITS = { message: 400, note: 200 };

type Draft = PlaceChoice & {
  senderName: string;
  recipientName: string;
  recipientTitle: string;
  recipientEmail: string;
  message: string;
  dateAt: string; // datetime-local value, Lagos time
  note: string;
  theme: LetterTheme;
  opensAt: string;
};

const EMPTY: Draft = {
  senderName: "",
  recipientName: "",
  recipientTitle: "",
  recipientEmail: "",
  message: "",
  city: "lagos",
  placeKey: "",
  placeName: "",
  placeArea: "",
  placeAddress: "",
  dateAt: "",
  note: "",
  theme: "rose",
  opensAt: "",
};

function asLetter(draft: Draft) {
  return dateLetter(
    {
      message: draft.message,
      place_name: draft.placeName,
      place_area: draft.placeArea,
      place_address: draft.placeAddress,
      date_at: lagosIso(draft.dateAt) ?? undefined,
      note: draft.note,
    },
    {
      senderName: draft.senderName,
      recipientName: draft.recipientName,
      recipientTitle: draft.recipientTitle,
      theme: draft.theme,
    },
  );
}

export function WriteDate({ loggedIn = false }: { loggedIn?: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(DRAFT_KEY, EMPTY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);

  const update = (changes: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...changes };
      saveDraft(DRAFT_KEY, next);
      return next;
    });
  };

  const ready =
    draft.senderName.trim() !== "" &&
    draft.recipientName.trim() !== "" &&
    draft.message.trim() !== "" &&
    draft.placeName.trim() !== "" &&
    draft.dateAt !== "";

  async function seal(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<Omit<Sealed, "letter" | "email">>("/experiences", {
        method: "POST",
        body: {
          type: "date_invite",
          sender_name: draft.senderName,
          recipient_name: draft.recipientName,
          recipient_title: draft.recipientTitle || null,
          theme: draft.theme,
          content: {
            message: draft.message,
            city: draft.city,
            // A place from our list: the server fills in its name and address itself.
            place_key: draft.placeKey || null,
            place_name: draft.placeKey ? null : draft.placeName,
            place_area: draft.placeKey ? null : draft.placeArea || null,
            place_address: draft.placeKey ? null : draft.placeAddress || null,
            date_at: lagosIso(draft.dateAt),
            note: draft.note || null,
          },
          opens_at: lagosIso(draft.opensAt),
          recipient_email: draft.recipientEmail.trim() || null,
        },
      });
      saveDraft(DRAFT_KEY, null);
      setSealed({ ...result, letter: asLetter(draft), email: draft.recipientEmail.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The account step: their draft is saved; they come straight back here.
        router.push(`/login?next=${encodeURIComponent("/write/date")}`);
        return;
      }
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sealed) {
    return (
      <SealedPanel sealed={sealed} whatsappText={t.whatsappText} anotherText={t.another}
        onAnother={() => { setDraft(EMPTY); setSealed(null); }} />
    );
  }

  const preview = <LetterCard placeholder={t.placeholder} letter={asLetter(draft)} />;

  return (
    <form onSubmit={seal} className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <TypeSwitch current="date_invite" />
          <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
          <p className="text-lg text-muted">{t.lead}</p>
        </header>

        <WhoFields draft={draft} update={update} />

        <fieldset className="flex flex-col gap-4">
          <legend className={legend} style={{ fontFamily: "var(--font-heading)" }}>
            {t.inviteHeading}
          </legend>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{t.suggestionsLabel}</span>
            <ul className="flex flex-col gap-2">
              {t.suggestions.map((line) => (
                <li key={line} className="flex items-center justify-between gap-3 rounded bg-surface p-3">
                  <span className="text-sm">{line}</span>
                  <button type="button" className="min-h-10 shrink-0 rounded-md border-2 border-fg px-3 text-sm font-bold"
                    onClick={() => update({ message: line })}>
                    {t.use}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <label className={label}>
            <span className="flex justify-between">
              {t.messageLabel}
              <span className="font-normal text-muted">
                {w.characters.replace("{count}", String(draft.message.length)).replace("{max}", String(LIMITS.message))}
              </span>
            </span>
            <textarea className={`${input} min-h-28 py-2 leading-relaxed`} name="message" required
              maxLength={LIMITS.message} value={draft.message}
              onChange={(e) => update({ message: e.target.value })} />
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className={legend} style={{ fontFamily: "var(--font-heading)" }}>
            {t.whereHeading}
          </legend>
          <PlacePicker value={draft} onChange={update} />
          <label className={label}>
            {t.whenLabel}
            <input className={input} type="datetime-local" name="date_at" required value={draft.dateAt}
              onChange={(e) => update({ dateAt: e.target.value })} />
          </label>
          <label className={label}>
            {t.noteLabel}
            <input className={input} name="note" maxLength={LIMITS.note} value={draft.note}
              onChange={(e) => update({ note: e.target.value })} />
            <span className={hint}>{t.noteHint}</span>
          </label>
        </fieldset>

        <LookFields draft={draft} update={update} />

        <div className="md:hidden">
          <h2 className="mb-4 text-2xl">{w.previewHeading}</h2>
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
            {busy ? w.sealing : w.seal}
          </button>
          {!loggedIn && <p className="text-sm text-muted">{w.sealNeedsAccount}</p>}
        </div>
      </div>

      <aside className="hidden md:block">
        <div className="sticky top-8 flex flex-col gap-4">
          <h2 className="text-2xl">{w.previewHeading}</h2>
          {preview}
        </div>
      </aside>
    </form>
  );
}
