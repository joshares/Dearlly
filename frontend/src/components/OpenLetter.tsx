"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { WaxSeal } from "@/components/brand";
import { LetterCard, type LetterContent, type LetterTheme } from "@/components/LetterCard";
import { ReportLetter } from "@/components/ReportLetter";
import { SaveLetter } from "@/components/SaveLetter";
import { ScratchCard } from "@/components/ScratchCard";
import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import { lagosDateTime, timeLeft } from "@/lib/dates";
import {
  type DateContent,
  dateLetter,
  directionsUrl,
  type GiftContent,
  giftLetter,
  type VacationContent,
  vacationLetter,
} from "@/lib/invitation";

const t = getMessages().letter;
const g = getMessages().gift;
const CITY_NAMES: Record<string, string> = { lagos: "Lagos", abuja: "Abuja" };

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
  opens_in_seconds: number;
  // Love note: quote_title / quote_text. Date invitation: see DateContent.
  content: Record<string, string | null | undefined> | null;
  reply_kind: "reaction" | "yes_no";
  photo?: { url: string; small_url: string; width: number; height: number } | null;
  reactions: Reaction[];
  reply: Reply | null;
  is_sender: boolean;
  // From a secret admirer who hasn't revealed their name (sender_name is "A secret admirer").
  secret?: boolean;
};

// Shown next to each reaction; the words come from the server's config.
export const REACTION_EMOJI: Record<string, string> = {
  love_it: "❤️",
  aww: "🥹",
  smiling: "😊",
  forever: "💌",
  thank_you: "🙏",
  cant_wait: "🤩",
  you_shouldnt: "🥰",
  yes: "🎉",
  no: "🤍",
};

/** The sender's name inside a sentence ("Let your secret admirer know…"), or starting one. */
function inSentence(letter: Letter, starts = false): string {
  if (!letter.secret || letter.is_sender) return letter.sender_name;
  return starts ? t.secretSender.charAt(0).toUpperCase() + t.secretSender.slice(1) : t.secretSender;
}

/** The letter as shown on paper, for whichever type it is. */
function asContent(letter: Letter, giftRevealed = false): LetterContent {
  const people = {
    senderName: letter.sender_name,
    recipientName: letter.recipient_name,
    recipientTitle: letter.recipient_title,
    theme: letter.theme,
    photo: letter.photo
      ? {
          url: letter.photo.url,
          smallUrl: letter.photo.small_url,
          width: letter.photo.width,
          height: letter.photo.height,
        }
      : null,
  };
  const c = letter.content ?? {};
  if (letter.type === "date_invite") return dateLetter(c as Partial<DateContent>, people);
  if (letter.type === "vacation_invite") return vacationLetter(c as Partial<VacationContent>, people);
  if (letter.type === "gift_reveal") return giftLetter(c as Partial<GiftContent>, people, giftRevealed);
  return { ...people, quoteTitle: c.quote_title, quoteText: c.quote_text ?? "" };
}

const OPENING_MS = 1600;
const NOTE_MAX = 280;

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** The recipient's page: a sealed envelope, then the letter and "Seal a reply". */
export function OpenLetter({ token, reportOpen = false }: { token: string; reportOpen?: boolean }) {
  const [letter, setLetter] = useState<Letter | null>(null);
  // When a sealed letter opens, by this phone's clock. Counted from the server's "seconds left",
  // so a phone whose clock is wrong still opens on time.
  const [opensAt, setOpensAt] = useState(0);
  const [missing, setMissing] = useState<string | null>(null);
  const [stage, setStage] = useState<"closed" | "opening" | "open">("closed");
  // Gift reveals: the gift stays under the scratch-off stamp until they scratch it.
  const [giftScratched, setGiftScratched] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(() => {
    api<Letter>(`/letters/${encodeURIComponent(token)}`)
      .then((fresh) => {
        setLetter(fresh);
        setOpensAt(Date.now() + fresh.opens_in_seconds * 1000);
      })
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

  if (blocked) {
    return (
      <section className="letter-sheet flex flex-col gap-4 rounded-sm py-10 pr-6 pl-12 md:pl-16" aria-live="polite">
        <h1 className="text-4xl">{t.blockedTitle}</h1>
        <p className="text-lg text-muted">{t.blockedLead}</p>
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
  // Report (every letter) and one-tap block (secret admirers), for the recipient.
  const safety = !letter.is_sender && (
    <>
      {letter.secret && <BlockAdmirer token={token} onBlocked={() => setBlocked(true)} />}
      <ReportLetter token={token} startOpen={reportOpen} />
    </>
  );

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
          <Countdown until={opensAt} onDone={load} />
        </section>
        {safety}
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
        {safety}
      </div>
    );
  }

  const isGift = letter.type === "gift_reveal";
  const giftAlreadyKnown = letter.is_sender || letter.reply !== null;
  const giftRevealed = !isGift || giftScratched || giftAlreadyKnown;
  // On screen the gift is on its stamp; a saved picture or PDF lists it (once revealed).
  const content = asContent(letter);
  const saved = asContent(letter, giftRevealed);

  return (
    <div className="flex flex-col gap-10">
      {letter.is_sender && (
        <p className="rounded-md border-2 border-dashed border-line bg-surface p-3 text-sm font-semibold">
          {t.senderNote} {letter.secret && t.senderSecretNote}
        </p>
      )}
      <div className="rise-in">
        <LetterCard placeholder="" letter={content} />
      </div>
      {isGift && letter.content?.gift && (
        <ScratchCard
          gift={letter.content.gift}
          hint={letter.content.hint}
          photo={content.giftPhoto}
          startRevealed={giftAlreadyKnown}
          onReveal={() => setGiftScratched(true)}
        />
      )}
      {giftRevealed && <SaveLetter letter={saved} />}
      {!giftRevealed ? (
        <p className="text-center text-muted">{g.scratchFirst}</p>
      ) : letter.reply ? (
        <ReplyShown letter={letter} reply={letter.reply} />
      ) : letter.is_sender ? (
        <p className="text-muted">{t.senderNoReply}</p>
      ) : letter.reply_kind === "yes_no" ? (
        <YesNoForm token={token} letter={letter} onSent={(reply) => setLetter({ ...letter, reply })} />
      ) : (
        <ReplyForm
          token={token}
          letter={letter}
          onSent={(reply) => setLetter({ ...letter, reply })}
        />
      )}
      {safety}
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
        <span className="font-hand block w-full truncate text-lg leading-snug">
          {t.to} {name}
        </span>
        <span className="font-hand block w-full truncate text-sm leading-snug opacity-80">
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

const RECHECK_MS = 3000;

function Countdown({ until, onDone }: { until: number; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const left = timeLeft(until, now);
  const done = left.d + left.h + left.m + left.s === 0;

  useEffect(() => {
    if (!done) {
      const id = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(id);
    }
    // Time's up: ask the server now, and keep asking until it says the letter is open
    // (this page then shows "Break the seal" by itself).
    onDone();
    const id = window.setInterval(onDone, RECHECK_MS);
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
        <h2 className="text-2xl">
          {letter.is_sender
            ? letter.reply_kind === "yes_no" ? t.theirAnswer : t.theirReply
            : letter.reply_kind === "yes_no"
              ? reply.reaction === "yes" ? t.saidYes : t.answerSent
              : t.repliedTitle}
        </h2>
        {!letter.is_sender && (
          <p className="text-sm text-muted">{fill(t.repliedLead, { sender: inSentence(letter, true) })}</p>
        )}
        <p className="text-xl font-bold">
          <span aria-hidden="true">{REACTION_EMOJI[reply.reaction]} </span>
          {reaction?.label ?? reply.reaction}
        </p>
        {reply.note && <p className="font-hand text-lg leading-loose">{reply.note}</p>}
      </div>
      {letter.type === "date_invite" && reply.reaction === "yes" && letter.content && (
        <a
          href={directionsUrl(letter.content as DateContent, CITY_NAMES[letter.content.city ?? ""] ?? "")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center self-start rounded-lg bg-stamp px-5 font-extrabold text-paper no-underline shadow-[3px_3px_0_var(--color-ink)]"
        >
          {t.directions}
        </a>
      )}
      {!letter.is_sender && <WriteBack type={letter.type} />}
    </section>
  );
}

// "Write your own…": the same kind of letter they just received.
const WRITE_BACK: Record<string, { href: string; text: string }> = {
  love_note: { href: "/write", text: t.writeBack },
  date_invite: { href: "/write/date", text: t.writeBackDate },
  vacation_invite: { href: "/write/vacation", text: t.writeBackTrip },
  gift_reveal: { href: "/write/gift", text: t.writeBackGift },
};

function WriteBack({ type }: { type: string }) {
  const target = WRITE_BACK[type] ?? WRITE_BACK.love_note!;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-muted">{t.writeBackLead}</p>
      <Link
        href={target.href}
        className="inline-flex min-h-12 items-center rounded-lg border-2 border-fg px-5 font-bold no-underline"
      >
        {target.text}
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
        <p className="text-muted">{fill(t.replyLead, { sender: inSentence(letter) })}</p>
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

const DODGES = 3;

/**
 * Yes, or the No that runs away. It dodges a few taps (it's a joke, not a trap), then stays still
 * so No can always be said. Keyboard users and "reduce motion" get a No that never moves.
 */
function YesNoForm({
  token,
  letter,
  onSent,
}: {
  token: string;
  letter: Letter;
  onSent: (reply: Reply) => void;
}) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [dodged, setDodged] = useState(0);
  const [spot, setSpot] = useState({ x: 0, y: 0 });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  // The tap that made No jump away must not also choose it.
  const skipClick = useRef(false);
  const label = (key: string) => letter.reactions.find((r) => r.key === key)?.label ?? key;

  function dodge(event: React.PointerEvent) {
    if (dodged >= DODGES || answer === "no" || reducedMotion()) return;
    event.preventDefault();
    const box = area.current?.getBoundingClientRect();
    const roomX = Math.max(0, (box?.width ?? 300) / 2 - 80);
    const roomY = 56;
    setSpot({ x: (Math.random() * 2 - 1) * roomX, y: (Math.random() * 2 - 1) * roomY });
    setDodged((n) => n + 1);
    skipClick.current = true;
    navigator.vibrate?.(15);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!answer) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await api<Reply>(`/letters/${encodeURIComponent(token)}/reply`, {
        method: "POST",
        body: { reaction: answer, note: note.trim() || null },
      });
      onSent(reply);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const choice = (key: "yes" | "no") =>
    `min-h-14 w-full rounded-lg border-2 px-6 text-lg font-extrabold transition-transform duration-200 ${
      answer === key ? "border-stamp bg-stamp text-paper shadow-[4px_4px_0_var(--color-ink)]" : "border-fg bg-surface"
    }`;

  return (
    <form onSubmit={send} className="flex flex-col gap-4" aria-labelledby="answer-title">
      <div>
        <h2 id="answer-title" className="text-3xl">
          {t.answerHeading}
        </h2>
        <p className="text-muted">{fill(t.answerLead, { sender: letter.sender_name })}</p>
      </div>
      <div ref={area} className="grid grid-cols-2 gap-3 py-16" role="radiogroup" aria-labelledby="answer-title">
        <button type="button" role="radio" aria-checked={answer === "yes"} className={choice("yes")}
          onClick={() => setAnswer("yes")}>
          {REACTION_EMOJI.yes} {label("yes")}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={answer === "no"}
          className={choice("no")}
          style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}
          // Touch: jump on the tap. Mouse: jump as the pointer arrives. (Phones also send a fake
          // mouse hover with each tap, so hover only counts for a real mouse.)
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") dodge(e);
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") dodge(e);
          }}
          onClick={() => {
            if (skipClick.current) {
              skipClick.current = false;
              return;
            }
            setAnswer("no");
          }}
        >
          {label("no")}
        </button>
      </div>
      {dodged > 0 && answer !== "no" && (
        <p className="text-center font-hand text-lg" aria-live="polite">
          {t.dodges[Math.min(dodged, t.dodges.length) - 1]}
        </p>
      )}
      {answer && (
        <>
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
              className="min-h-24 w-full rounded-md border-2 border-fg bg-surface px-3 py-2 text-base leading-relaxed"
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
            {busy ? t.sendingReply : t.sendAnswer}
          </button>
        </>
      )}
    </form>
  );
}

/** One tap, no questions: the letter is gone for good (and they can't email this address). */
function BlockAdmirer({ token, onBlocked }: { token: string; onBlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    setBusy(true);
    setError(null);
    try {
      await api(`/letters/${encodeURIComponent(token)}/block`, { method: "POST" });
      onBlocked();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-1 text-center">
      <button type="button" onClick={block} disabled={busy}
        className="min-h-12 rounded-lg border-2 border-stamp px-5 font-bold text-accent-text disabled:opacity-60">
        {busy ? t.blocking : t.block}
      </button>
      <p className="max-w-sm text-sm text-muted">{t.blockHint}</p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-accent-text">
          {error}
        </p>
      )}
    </div>
  );
}
