"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { draftPhoto, NO_PHOTO, PhotoField } from "@/components/PhotoField";
import { LetterCard, type LetterTheme } from "@/components/LetterCard";
import { ScratchCard } from "@/components/ScratchCard";
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
import { giftLetter } from "@/lib/invitation";

const t = getMessages().gift;
const p = getMessages().photo;
const w = getMessages().write;

const DRAFT_KEY = "dearlly:draft:gift_reveal";
// Same limits as the server (backend/config/experience_types.yaml); the server checks again.
const LIMITS = { message: 400, gift: 120, hint: 80, note: 200 };

type Draft = {
  senderName: string;
  recipientName: string;
  recipientTitle: string;
  recipientEmail: string;
  message: string;
  gift: string;
  hint: string;
  note: string;
  theme: LetterTheme;
  photoId: string;
  photoUrl: string;
  photoSmallUrl: string;
  photoWidth: number;
  photoHeight: number;
  opensAt: string; // datetime-local value, WAT
};

const EMPTY: Draft = {
  senderName: "",
  recipientName: "",
  recipientTitle: "",
  recipientEmail: "",
  message: "",
  gift: "",
  hint: "",
  note: "",
  theme: "cream",
  ...NO_PHOTO,
  opensAt: "",
};

function asLetter(draft: Draft, withGift = false) {
  return giftLetter(
    { message: draft.message, gift: draft.gift, note: draft.note },
    {
      senderName: draft.senderName,
      recipientName: draft.recipientName,
      recipientTitle: draft.recipientTitle,
      theme: draft.theme,
      photo: draftPhoto(draft),
    },
    withGift,
  );
}

export function WriteGift({ loggedIn = false }: { loggedIn?: boolean }) {
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
    draft.gift.trim() !== "";

  async function seal(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<Omit<Sealed, "letter" | "email">>("/experiences", {
        method: "POST",
        body: {
          type: "gift_reveal",
          sender_name: draft.senderName,
          recipient_name: draft.recipientName,
          recipient_title: draft.recipientTitle || null,
          theme: draft.theme,
          content: {
            message: draft.message,
            gift: draft.gift,
            hint: draft.hint || null,
            note: draft.note || null,
            photo: draft.photoId || null,
          },
          opens_at: lagosIso(draft.opensAt),
          recipient_email: draft.recipientEmail.trim() || null,
        },
      });
      saveDraft(DRAFT_KEY, null);
      setSealed({ ...result, letter: asLetter(draft, true), email: draft.recipientEmail.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // The account step: their draft is saved; they come straight back here.
        router.push(`/login?next=${encodeURIComponent("/write/gift")}`);
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

  const preview = (
    <div className="flex flex-col gap-6">
      <LetterCard placeholder={t.placeholder} letter={asLetter(draft)} />
      {(draft.gift.trim() || draft.photoId) && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{t.tryIt}</span>
          {/* A fresh stamp whenever the gift or hint changes. */}
          <ScratchCard key={`${draft.gift}|${draft.hint}|${draft.photoId}`} gift={draft.gift} hint={draft.hint}
            photo={draftPhoto(draft)} />
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={seal} className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12">
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <TypeSwitch current="gift_reveal" />
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
            {t.giftHeading}
          </legend>
          <label className={label}>
            {t.giftLabel}
            <input className={input} name="gift" required maxLength={LIMITS.gift}
              value={draft.gift} onChange={(e) => update({ gift: e.target.value })} />
            <span className={hint}>{t.giftHint}</span>
          </label>
          <label className={label}>
            {t.hintLabel}
            <input className={input} name="hint" maxLength={LIMITS.hint} value={draft.hint}
              onChange={(e) => update({ hint: e.target.value })} />
            <span className={hint}>{t.hintHint}</span>
          </label>
          <label className={label}>
            {t.noteLabel}
            <input className={input} name="note" maxLength={LIMITS.note} value={draft.note}
              onChange={(e) => update({ note: e.target.value })} />
            <span className={hint}>{t.noteHint}</span>
          </label>
        </fieldset>

        <PhotoField value={draft} onChange={update} loggedIn={loggedIn} next="/write/gift"
          labelText={p.giftLabel} hintText={p.giftHint} />

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
