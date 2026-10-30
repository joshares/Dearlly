"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { WaxSeal } from "@/components/brand";
import { LetterCard, type LetterTheme } from "@/components/LetterCard";
import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import { lagosDateTime, timeLeft } from "@/lib/dates";

const t = getMessages().letter;

type Reaction = { key: string; label: string };
type Reply = { reaction: string; note: string | null; replied_at: string };

export type Letter = {
  status: "ready" | "sealed_until";
  type: string;
  sender_name: string;
  recipient_name: string;
  recipient_title: string | null;
  theme: LetterTheme;
  opens_at: string | null;
  content: { quote_title?: string | null; quote_text: string } | null;
  reactions: Reaction[];
  reply: Reply | null;
  is_sender: boolean;
};

// Shown next to each reaction; the words come from the server's config.
export const REACTION_EMOJI: Record<string, string> = {
  love_it: "❤️",
  aww: "🥹",
  smiling: "😊",
  forever: "💌",
};

const OPENING_MS = 1600;
const NOTE_MAX = 280;

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** The recipient's page: a sealed envelope, then the letter and "Seal a reply". */
export function OpenLetter({ token }: { token: string }) {
  const [letter, setLetter] = useState<Letter | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [stage, setStage] = useState<"closed" | "opening" | "open">("closed");

  const load = useCallback(() => {
    api<Letter>(`/letters/${encodeURIComponent(token)}`)
      .then(setLetter)
      .catch((err: unknown) => {
        setMissing(
          err instanceof ApiError && err.status !== 404
            ? err.detail
            : t.notFound,
        );
      });
  }, [token]);

  useEffect(load, [load]);

  function breakSeal() {
    if (stage !== "closed" || !letter) return;
    // Only breaking the seal counts as Opened (link previews only fetch the page).
    api(`/letters/${encodeURIComponent(token)}/open`, { method: "POST" }).catch(() => undefined);
    if (reducedMotion()) {
      setStage("open");
      return;
    }
    navigator.vibrate?.(30);
    setStage("opening");
    window.setTimeout(() => setStage("open"), OPENING_MS);
  }

  if (missing) {
    return (
      <section className="letter-sheet flex flex-col gap-4 rounded-sm py-10 pr-6 pl-12 md:pl-16">
        <h1 className="text-4xl">{t.notFoundTitle}</h1>
        <p role="alert" className="text-lg text-muted">
          {missing}
        </p>
        <Link href="/" className="font-bold underline">
          {t.goHome}
        </Link>
      </section>
    );
  }

  if (!letter) {
    return <p className="font-hand py-16 text-center text-lg text-muted">{t.loading}</p>;
  }

  const name = letter.recipient_title?.trim() || letter.recipient_name;

  if (letter.status === "sealed_until" && letter.opens_at) {
    return (
      <div className="flex flex-col items-center gap-8 pt-10">
        <Envelope letter={letter} name={name} disabled />
        <section className="flex flex-col items-center gap-3 text-center" aria-live="polite">
          <h1 className="text-4xl">{t.sealedTitle}</h1>
          <p className="text-lg text-muted">
            {fill(t.sealedLead, {
              sender: letter.sender_name,
              when: lagosDateTime(letter.opens_at),
            })}
          </p>
          <Countdown until={letter.opens_at} onDone={load} />
        </section>
      </div>
    );
  }

  if (stage !== "open" || !letter.content) {
    return (
      <div className="flex flex-col items-center gap-6 pt-10">
        <Envelope
          letter={letter}
          name={name}
          opening={stage === "opening"}
          onOpen={breakSeal}
        />
        <button
          type="button"
          onClick={breakSeal}
          disabled={stage !== "closed"}
          className="min-h-14 w-full max-w-xs rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-60"
        >
          {t.breakSeal}
        </button>
        <p className="text-sm text-muted">{t.breakHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {letter.is_sender && (
        <p className="rounded-md border-2 border-dashed border-line bg-surface p-3 text-sm font-semibold">
          {t.senderNote}
        </p>
      )}
      <div className="rise-in">
        <LetterCard
          placeholder=""
          letter={{
            senderName: letter.sender_name,
            recipientName: letter.recipient_name,
            recipientTitle: letter.recipient_title,
            quoteTitle: letter.content.quote_title,
            quoteText: letter.content.quote_text,
            theme: letter.theme,
          }}
        />
      </div>
      {letter.reply ? (
        <ReplyShown letter={letter} reply={letter.reply} />
      ) : letter.is_sender ? (
        <p className="text-muted">{t.senderNoReply}</p>
      ) : (
        <ReplyForm
          token={token}
          letter={letter}
          onSent={(reply) => setLetter({ ...letter, reply })}
        />
      )}
    </div>
  );
}

function Envelope({
  letter,
  name,
  opening = false,
  disabled = false,
  onOpen,
}: {
  letter: Letter;
  name: string;
  opening?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled || opening}
      aria-label={fill(t.envelopeLabel, { name, sender: letter.sender_name })}
      className={`relative mt-16 block aspect-[3/2] w-full max-w-md cursor-pointer [perspective:900px] disabled:cursor-default ${
        opening ? "is-opening" : ""
      }`}
    >
      {/* Inside of the envelope */}
      <span className="absolute inset-0 rounded-md border-2 border-ink bg-[#C89B6D]" />
      {/* The letter, which slides up when the flap opens */}
      <span
        className="envelope-paper absolute inset-x-5 top-3 bottom-3 z-10 rounded-sm border border-ink/30 bg-[#FBF6EE]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(transparent 0 17px, rgb(31 42 107 / 0.12) 17px 18px)",
        }}
      />
      {/* Front pocket with the address */}
      <svg
        viewBox="0 0 300 200"
        preserveAspectRatio="none"
        className="absolute inset-0 z-20 h-full w-full"
        aria-hidden="true"
      >
        <path
          d="M2 60 L150 132 L298 60 V198 H2 Z"
          fill="#C89B6D"
          stroke="#1F2A6B"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="absolute right-0 bottom-3 left-0 z-30 flex flex-col items-start gap-0.5 px-6 text-left text-ink">
        <span className="font-hand text-lg leading-snug">
          {t.to} {name}
        </span>
        <span className="font-hand text-sm leading-snug opacity-80">
          {t.from} {letter.sender_name}
        </span>
      </span>
      {/* Flap, hinged at the top */}
      <svg
        viewBox="0 0 300 120"
        preserveAspectRatio="none"
        className="envelope-flap absolute inset-x-0 top-0 z-40 h-[60%] w-full"
        aria-hidden="true"
      >
        <path
          d="M2 2 L150 116 L298 2 Z"
          fill="#D4AC80"
          stroke="#1F2A6B"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      {/* Wax seal on the flap's tip, in two halves that crack apart */}
      <span className="absolute top-[57%] left-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
        <span className="seal-half seal-left absolute inset-0 [clip-path:inset(0_50%_0_0)]">
          <WaxSeal size={68} />
        </span>
        <span className="seal-half seal-right block [clip-path:inset(0_0_0_50%)]">
          <WaxSeal size={68} />
        </span>
      </span>
    </button>
  );
}

function Countdown({ until, onDone }: { until: string; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const left = timeLeft(until, now);
  const done = left.d + left.h + left.m + left.s === 0;

  useEffect(() => {
    if (done) {
      onDone();
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [done, onDone]);

  const parts = (["d", "h", "m", "s"] as const).filter((unit, i) => i > 0 || left.d > 0);
  return (
    <p className="flex flex-col items-center gap-2">
      <span className="text-sm font-semibold text-muted">{t.opensIn}</span>
      <span className="flex gap-3 font-heading text-4xl tabular-nums" role="timer">
        {parts.map((unit) => (
          <span key={unit}>
            {String(left[unit]).padStart(2, "0")}
            <span className="ml-0.5 text-lg">{t.units[unit]}</span>
          </span>
        ))}
      </span>
    </p>
  );
}

function ReplyShown({ letter, reply }: { letter: Letter; reply: Reply }) {
  const reaction = letter.reactions.find((r) => r.key === reply.reaction);
  return (
    <section className="flex flex-col gap-4" aria-live="polite">
      <div className="letter-sheet flex flex-col gap-2 rounded-sm py-6 pr-6 pl-12 md:pl-16">
        <h2 className="text-2xl">{letter.is_sender ? t.theirReply : t.repliedTitle}</h2>
        {!letter.is_sender && (
          <p className="text-sm text-muted">{fill(t.repliedLead, { sender: letter.sender_name })}</p>
        )}
        <p className="text-xl font-bold">
          <span aria-hidden="true">{REACTION_EMOJI[reply.reaction]} </span>
          {reaction?.label ?? reply.reaction}
        </p>
        {reply.note && <p className="font-hand text-lg leading-loose">{reply.note}</p>}
      </div>
      {!letter.is_sender && <WriteBack />}
    </section>
  );
}

function WriteBack() {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-muted">{t.writeBackLead}</p>
      <Link
        href="/write"
        className="inline-flex min-h-12 items-center rounded-lg border-2 border-fg px-5 font-bold no-underline"
      >
        {t.writeBack}
      </Link>
    </div>
  );
}

function ReplyForm({
  token,
  letter,
  onSent,
}: {
  token: string;
  letter: Letter;
  onSent: (reply: Reply) => void;
}) {
  const [reaction, setReaction] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!reaction) {
      setError(t.pickReaction);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const reply = await api<Reply>(`/letters/${encodeURIComponent(token)}/reply`, {
        method: "POST",
        body: { reaction, note: note.trim() || null },
      });
      onSent(reply);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4" aria-labelledby="reply-title">
      <div>
        <h2 id="reply-title" className="text-3xl">
          {t.replyHeading}
        </h2>
        <p className="text-muted">{fill(t.replyLead, { sender: letter.sender_name })}</p>
      </div>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="reply-title">
        {letter.reactions.map((r) => (
          <label
            key={r.key}
            className={`flex min-h-14 cursor-pointer items-center gap-2 rounded-lg border-2 bg-surface px-3 font-bold ${
              reaction === r.key ? "border-stamp shadow-[3px_3px_0_var(--color-ink)]" : "border-line"
            }`}
          >
            <input
              type="radio"
              name="reaction"
              value={r.key}
              className="sr-only"
              checked={reaction === r.key}
              onChange={() => setReaction(r.key)}
            />
            <span aria-hidden="true" className="text-xl">
              {REACTION_EMOJI[r.key]}
            </span>
            {r.label}
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        <span className="flex justify-between">
          {t.noteLabel}
          <span className="font-normal text-muted">
            {note.length}/{NOTE_MAX}
          </span>
        </span>
        <textarea
          name="note"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-28 w-full rounded-md border-2 border-fg bg-surface px-3 py-2 text-base leading-relaxed"
        />
      </label>
      {error && (
        <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="min-h-14 rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-60"
      >
        {busy ? t.sendingReply : t.sendReply}
      </button>
    </form>
  );
}
