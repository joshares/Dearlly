"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PhotoField } from "@/components/PhotoField";
import { LetterCard, type LetterTheme } from "@/components/LetterCard";
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
import { vacationLetter } from "@/lib/invitation";

const t = getMessages().vacation;
const w = getMessages().write;

const DRAFT_KEY = "dearlly:draft:vacation_invite";
// Same limits as the server (backend/config/experience_types.yaml); the server checks again.
const LIMITS = { message: 400, destination: 80, packing: 300, note: 200 };

type Draft = {
  senderName: string;
  recipientName: string;
  recipientTitle: string;
  recipientEmail: string;
  message: string;
  destination: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  packing: string;
  note: string;
  theme: LetterTheme;
  photoId: string;
  photoUrl: string; // a signed link, refreshed when a saved draft comes back
  opensAt: string; // datetime-local value, WAT
};

const EMPTY: Draft = {
  senderName: "",
  recipientName: "",
  recipientTitle: "",
  recipientEmail: "",
  message: "",
  destination: "",
  startDate: "",
  endDate: "",
  packing: "",
  note: "",
  theme: "kraft",
  photoId: "",
  photoUrl: "",
  opensAt: "",
};

function asLetter(draft: Draft) {
  return vacationLetter(
    {
      message: draft.message,
      destination: draft.destination,
      start_date: draft.startDate,
      end_date: draft.endDate,
      packing: draft.packing,
      note: draft.note,
    },
    {
      senderName: draft.senderName,
      recipientName: draft.recipientName,
      recipientTitle: draft.recipientTitle,
      theme: draft.theme,
      photo: draft.photoUrl,
    },
  );
}

export function WriteVacation({ loggedIn = false }: { loggedIn?: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(DRAFT_KEY, EMPTY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);

  const update = (changes: Partial<Draft>) => {
    setDraft((current) => {
      const next = { ...current, ...changes };
      // Coming back can't be before leaving: move it along with the start.
      if (changes.startDate && (!next.endDate || next.endDate < changes.startDate)) next.endDate = changes.startDate;
      saveDraft(DRAFT_KEY, next);
      return next;
    });
  };

  const ready =
    draft.senderName.trim() !== "" &&
    draft.recipientName.trim() !== "" &&
    draft.message.trim() !== "" &&
    draft.destination.trim() !== "" &&
    draft.startDate !== "" &&
    draft.endDate !== "";

  async function seal(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<Omit<Sealed, "letter" | "email">>("/experiences", {
        method: "POST",
        body: {
          type: "vacation_invite",
          sender_name: draft.senderName,
          recipient_name: draft.recipientName,
          recipient_title: draft.recipientTitle || null,
          theme: draft.theme,
          content: {
            message: draft.message,
            destination: draft.destination,
            start_date: draft.startDate,
            end_date: draft.endDate,
            packing: draft.packing || null,
            note: draft.note || null,
            photo: draft.photoId || null,
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
        router.push(`/login?next=${encodeURIComponent("/write/vacation")}`);
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
          <TypeSwitch current="vacation_invite" />
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
            {t.tripHeading}
          </legend>
          <label className={label}>
            {t.destinationLabel}
            <input className={input} name="destination" required maxLength={LIMITS.destination}
              value={draft.destination} onChange={(e) => update({ destination: e.target.value })} />
            <span className={hint}>{t.destinationHint}</span>
          </label>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <label className={label}>
              {t.startLabel}
              <input className={input} type="date" name="start_date" required value={draft.startDate}
                onChange={(e) => update({ startDate: e.target.value })} />
            </label>
            <label className={label}>
              {t.endLabel}
              <input className={input} type="date" name="end_date" required min={draft.startDate || undefined}
                value={draft.endDate} onChange={(e) => update({ endDate: e.target.value })} />
            </label>
          </div>
          <label className={label}>
            {t.packingLabel}
            <input className={input} name="packing" maxLength={LIMITS.packing} value={draft.packing}
              onChange={(e) => update({ packing: e.target.value })} />
            <span className={hint}>{t.packingHint}</span>
          </label>
          <label className={label}>
            {t.noteLabel}
            <input className={input} name="note" maxLength={LIMITS.note} value={draft.note}
              onChange={(e) => update({ note: e.target.value })} />
            <span className={hint}>{t.noteHint}</span>
          </label>
        </fieldset>

        <PhotoField value={draft} onChange={update} loggedIn={loggedIn} next="/write/vacation" />

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
