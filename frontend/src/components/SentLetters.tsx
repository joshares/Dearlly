"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { REACTION_EMOJI } from "@/components/OpenLetter";
import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import { lagosDate, lagosDateTime } from "@/lib/dates";

const t = getMessages().sent;

export type SentLetter = {
  id: string;
  type: string;
  url: string | null;
  recipient_name: string;
  recipient_title: string | null;
  created_at: string;
  opens_at: string | null;
  first_opened_at: string | null;
  open_count: number;
  reply: { reaction: string; note: string | null; replied_at: string } | null;
  revoked: boolean;
};

type ExperienceType = { key: string; reactions: { key: string; label: string }[] };

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** The sender's letters on their profile: Opened, Replied, copy the link, take it back. */
export function SentLetters() {
  const [letters, setLetters] = useState<SentLetter[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SentLetter[]>("/me/experiences")
      .then(setLetters)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : "Something went wrong."));
    api<ExperienceType[]>("/experience-types")
      .then((types) =>
        setLabels(Object.fromEntries(types.flatMap((k) => k.reactions.map((r) => [r.key, r.label])))),
      )
      .catch(() => setLabels({}));
  }, []);

  return (
    <section aria-labelledby="sent-title" className="flex flex-col gap-4">
      <h2 id="sent-title" className="text-2xl">
        {t.title}
      </h2>
      {error && <p role="alert">{error}</p>}
      {letters?.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted">{t.empty}</p>
          <Link href="/write" className="font-bold underline">
            {t.writeFirst}
          </Link>
        </div>
      )}
      {letters && letters.length > 0 && (
        <ul className="flex flex-col gap-3">
          {letters.map((letter) => (
            <SentItem
              key={letter.id}
              letter={letter}
              reactionLabel={letter.reply ? (labels[letter.reply.reaction] ?? letter.reply.reaction) : ""}
              onChange={(updated) =>
                setLetters((all) => all?.map((l) => (l.id === updated.id ? updated : l)) ?? null)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function status(letter: SentLetter, reactionLabel: string): string {
  if (letter.revoked) return t.revoked;
  if (letter.reply) {
    return fill(t.replied, {
      reaction: `${REACTION_EMOJI[letter.reply.reaction] ?? ""} ${reactionLabel}`.trim(),
    });
  }
  if (letter.opens_at && new Date(letter.opens_at).getTime() > Date.now()) {
    return fill(t.sealedUntil, { when: lagosDateTime(letter.opens_at) });
  }
  if (letter.first_opened_at) {
    const date = lagosDateTime(letter.first_opened_at);
    return letter.open_count > 1
      ? fill(t.openedTimes, { date, count: letter.open_count })
      : fill(t.opened, { date });
  }
  return t.waiting;
}

function SentItem({
  letter,
  reactionLabel,
  onChange,
}: {
  letter: SentLetter;
  reactionLabel: string;
  onChange: (letter: SentLetter) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = letter.recipient_title?.trim() || letter.recipient_name;
  const done = Boolean(letter.reply);

  async function copy() {
    if (!letter.url) return;
    try {
      await navigator.clipboard.writeText(letter.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function takeBack() {
    setBusy(true);
    try {
      onChange(await api<SentLetter>(`/me/experiences/${letter.id}/revoke`, { method: "POST" }));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border-2 border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-hand text-lg">{fill(t.to, { name })}</span>
        <span className="text-sm text-muted">{fill(t.sentOn, { date: lagosDate(letter.created_at) })}</span>
      </div>
      <p className={`text-sm font-bold ${done ? "text-accent-text" : ""}`}>{status(letter, reactionLabel)}</p>
      {letter.reply?.note && <p className="font-hand leading-loose">“{letter.reply.note}”</p>}
      {letter.url && !confirming && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copy} className="min-h-12 rounded-md border-2 border-fg px-4 text-sm font-bold">
            {copied ? t.copied : t.copyLink}
          </button>
          <Link
            href={new URL(letter.url).pathname}
            className="inline-flex min-h-12 items-center rounded-md border-2 border-fg px-4 text-sm font-bold no-underline"
          >
            {t.view}
          </Link>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-12 rounded-md px-4 text-sm font-bold text-accent-text underline"
          >
            {t.takeBack}
          </button>
        </div>
      )}
      {confirming && (
        <div className="flex flex-col gap-2 rounded-md border-2 border-dashed border-stamp p-3">
          <p className="text-sm font-semibold">{t.takeBackConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={takeBack}
              className="min-h-12 rounded-md bg-stamp px-4 text-sm font-bold text-paper disabled:opacity-60"
            >
              {t.takeBackYes}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-12 rounded-md border-2 border-fg px-4 text-sm font-bold"
            >
              {t.takeBackNo}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
