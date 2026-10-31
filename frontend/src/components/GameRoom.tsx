"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import { type ChatMessage, type GameRound, type GameView, type Move, useGame } from "@/lib/game-socket";

const t = getMessages().games;

type GameInfo = {
  code: string;
  format: string;
  format_name: string;
  intensity: keyof typeof t.levels;
  rounds: number;
  status: "lobby" | "playing" | "ended";
  host_name: string;
  you: "host" | "guest" | "visitor";
  full: boolean;
};

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

const primary =
  "min-h-14 rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-50 disabled:shadow-none";
const secondary = "min-h-12 rounded-lg border-2 border-fg bg-surface px-5 font-bold disabled:opacity-50";
const sheet = "letter-sheet flex flex-col gap-5 rounded-sm py-8 pr-6 pl-12 md:py-10 md:pr-10 md:pl-16";

/** /play/<code>: join, wait for each other, play live, see the results; chat all along. */
export function GameRoom({ code }: { code: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<GameInfo | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<GameInfo>(`/games/${encodeURIComponent(code)}`)
      .then(setInfo)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`/play/${code}`)}`);
        } else {
          setMissing(true);
        }
      });
  }, [code, router]);

  if (missing) return <Message text={t.notFound} />;
  if (!info) return <p className="font-hand py-16 text-center text-lg text-muted">{t.loading}</p>;
  if (info.you === "visitor") {
    if (info.status !== "lobby") return <Message text={t.finished} />;
    if (info.full) return <Message text={t.full} />;
    return <JoinPanel info={info} onJoined={setInfo} />;
  }
  return <Live info={info} />;
}

function Message({ text }: { text: string }) {
  return (
    <section className={sheet}>
      <p role="alert" className="text-lg">{text}</p>
      <Link href="/games" className="font-bold underline">{t.goGames}</Link>
    </section>
  );
}

function JoinPanel({ info, onJoined }: { info: GameInfo; onJoined: (info: GameInfo) => void }) {
  const [intenseOk, setIntenseOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intense = info.intensity === "intense";

  async function join() {
    setBusy(true);
    setError(null);
    try {
      onJoined(
        await api<GameInfo>(`/games/${encodeURIComponent(info.code)}/join`, {
          method: "POST",
          body: { intense_ok: intenseOk },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t.error);
      setBusy(false);
    }
  }

  return (
    <section className={`${sheet} mx-auto max-w-xl`}>
      <h1 className="text-3xl leading-tight md:text-4xl">{fill(t.invitedTitle, { host: info.host_name })}</h1>
      <p className="text-2xl font-heading">{info.format_name}</p>
      <p className="text-muted">
        {t.levels[info.intensity]} · {info.rounds} {t.roundsLabel.toLowerCase()}
      </p>
      {intense && (
        <label className="flex min-h-12 items-start gap-3 rounded-md border-2 border-dashed border-stamp p-3">
          <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-stamp)]" checked={intenseOk}
            onChange={(e) => setIntenseOk(e.target.checked)} />
          <span className="font-semibold">{t.intenseConfirm}</span>
        </label>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-accent-text">{error}</p>}
      <button type="button" className={primary} disabled={busy || (intense && !intenseOk)} onClick={join}>
        {busy ? t.joining : t.join}
      </button>
    </section>
  );
}

function Live({ info }: { info: GameInfo }) {
  const { view, chat, connection, error, send } = useGame(info.code, true);

  if (connection === "gone") return <Message text={t.gone} />;
  if (connection === "denied") return <Message text={t.notFound} />;
  if (!view) return <p className="font-hand py-16 text-center text-lg text-muted">{t.loading}</p>;

  const names = Object.fromEntries(view.players.map((p) => [p.id, p.id === view.me ? t.you : p.name]));
  const other = view.players.find((p) => p.id !== view.me);

  return (
    // minmax(0, …): the game column shrinks to the phone instead of growing to its widest line.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">
        {connection === "reconnecting" && (
          <p role="status" className="rounded-md border-2 border-dashed border-line bg-surface p-2 text-center text-sm font-semibold">
            {t.reconnecting}
          </p>
        )}
        {view.status === "lobby" && <Lobby info={info} view={view} send={send} />}
        {view.status === "playing" && view.round && (
          <Round view={view} round={view.round} names={names} otherName={other?.name ?? ""} send={send} />
        )}
        {view.status === "ended" && <Results view={view} names={names} />}
        {error && (
          <p role="alert" className="rounded-md border-2 border-stamp bg-surface p-3 text-sm font-semibold">{error}</p>
        )}
      </div>
      <Chat chat={chat} me={view.me} send={send} />
    </div>
  );
}

// --- lobby ---------------------------------------------------------------------------------

function Lobby({ info, view, send }: { info: GameInfo; view: GameView; send: (m: Move) => void }) {
  const me = view.players.find((p) => p.id === view.me);
  const both = view.players.length === 2;
  return (
    <section className={sheet} aria-labelledby="lobby-title">
      <div>
        <h1 id="lobby-title" className="text-3xl md:text-4xl">{t.lobbyTitle}</h1>
        <p className="text-muted">
          {info.format_name} · {t.levels[info.intensity]} · {info.rounds} {t.roundsLabel.toLowerCase()}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {view.players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-md border-2 border-line bg-surface p-3">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${p.online ? "bg-[#2E8B57]" : "bg-line"}`} />
              <span className="truncate font-bold">
                {p.name}
                {p.id === view.me && <span className="font-normal text-muted"> ({t.you})</span>}
                {p.id === view.host && <span className="font-normal text-muted"> · {t.host}</span>}
              </span>
              <span className="sr-only">{p.online ? t.online : t.offline}</span>
            </span>
            <span className={`shrink-0 text-sm font-bold ${p.ready ? "text-accent-text" : "text-muted"}`}>
              {p.ready ? `${t.readyLabel} ✓` : t.notReady}
            </span>
          </li>
        ))}
      </ul>
      {!both && <Invite info={info} />}
      {both && !me?.ready && (
        <button type="button" className={primary} onClick={() => send({ t: "ready" })}>{t.imReady}</button>
      )}
      {both && me?.ready && <p className="font-hand text-lg text-muted">{t.waitingReady}</p>}
      {!both && <p className="font-hand text-lg text-muted">{t.waitingFor}</p>}
    </section>
  );
}

function Invite({ info }: { info: GameInfo }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/play/${info.code}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${fill(t.whatsappText, { game: info.format_name })} ${link}`)}`;
  return (
    <div className="flex flex-col gap-3 rounded-md border-2 border-dashed border-line bg-surface p-3 sm:p-4">
      <h2 className="text-xl">{t.inviteHeading}</h2>
      <p className="text-sm text-muted">{t.inviteLead}</p>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{t.code}</span>
        {/* Sized to the screen: six wide letters must never push past a small phone. */}
        <span className="font-heading text-[clamp(1.5rem,8vw,2.25rem)] leading-none tracking-[0.12em] whitespace-nowrap">
          {info.code}
        </span>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <a href={whatsapp} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-stamp px-3 text-center font-extrabold whitespace-nowrap text-paper no-underline shadow-[3px_3px_0_var(--color-ink)] sm:px-5">
          {t.whatsapp}
        </a>
        <button type="button" className={secondary}
          onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}>
          {copied ? t.copied : t.copyLink}
        </button>
      </div>
    </div>
  );
}

// --- a round -------------------------------------------------------------------------------

function Round({
  view,
  round,
  names,
  otherName,
  send,
}: {
  view: GameView;
  round: GameRound;
  names: Record<string, string>;
  otherName: string;
  send: (m: Move) => void;
}) {
  const isHost = view.me === view.host;
  const last = round.number >= view.total;
  const myTurn = round.subject === view.me;
  const turnGame = round.answer === "truth_dare";
  const guessGame = !turnGame && round.subject !== null;
  const me = view.players.find((p) => p.id === view.me);
  const otherAnswered = round.answered.some((id) => id !== view.me);
  const waitingOn = turnGame ? !round.revealed && round.subject !== view.me : !round.revealed;

  let cue: string | null = null;
  if (guessGame) cue = myTurn ? t.aboutYou : fill(t.guessFor, { name: otherName });
  if (turnGame) cue = myTurn ? t.yourTurn : fill(t.theirTurn, { name: otherName });

  return (
    <section className={sheet} aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-extrabold tracking-[0.12em] text-muted uppercase">
          {fill(t.round, { number: round.number, total: view.total })} · {round.format_name}
        </p>
        {round.seconds_left !== null && !round.revealed && <Timer key={view.version} seconds={round.seconds_left} />}
      </div>
      {cue && <p className="font-hand text-xl">{cue}</p>}

      {turnGame && round.choice === null ? (
        myTurn ? (
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={primary} onClick={() => send({ t: "pick", value: "truth" })}>{t.truth}</button>
            <button type="button" className={primary} onClick={() => send({ t: "pick", value: "dare" })}>{t.dare}</button>
          </div>
        ) : (
          <p className="text-lg text-muted">{fill(t.picking, { name: otherName })}</p>
        )
      ) : (
        <>
          {turnGame && round.choice && (
            <p className="self-start rounded-full border-2 border-stamp px-3 py-1 text-sm font-extrabold text-accent-text uppercase">
              {round.choice === "truth" ? t.truth : t.dare}
            </p>
          )}
          <h1 className="text-3xl leading-tight md:text-4xl">{round.text}</h1>
          <Answer round={round} send={send} otherName={otherName} />
        </>
      )}

      {!round.revealed && waitingOn && (
        <p className="text-sm font-semibold text-muted">
          {otherAnswered ? fill(t.answered, { name: otherName }) : fill(t.thinking, { name: otherName })}
        </p>
      )}

      {round.revealed && <Reveal view={view} round={round} names={names} otherName={otherName} />}

      <div className="flex flex-wrap items-center gap-3 border-t-2 border-dashed border-line pt-4">
        {/* Games with skips (Deep talk, Get to know you): each player has a few. */}
        {!round.revealed && me && me.skips_left > 0 && (
          <button type="button" className={secondary} onClick={() => send({ t: "skip" })}>
            {fill(t.skip, { count: me.skips_left })}
          </button>
        )}
        {isHost ? (
          <>
            <button type="button" className={round.revealed ? primary : secondary} onClick={() => send({ t: "next" })}>
              {last ? t.finish : round.revealed ? t.next : t.skipQuestion}
            </button>
            {!last && <EndGame send={send} />}
          </>
        ) : (
          round.revealed && <p className="text-sm text-muted">{fill(t.hostMovesOn, { name: otherName })}</p>
        )}
      </div>
    </section>
  );
}

function Answer({ round, send, otherName }: { round: GameRound; send: (m: Move) => void; otherName: string }) {
  const [text, setText] = useState("");
  if (round.answer === "choice") {
    return (
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t.yourAnswer}>
        {round.options.map((option, i) => (
          <button key={option} type="button" disabled={!round.can_answer}
            aria-pressed={round.my_choice === i}
            onClick={() => send({ t: "answer", value: i })}
            className={`min-h-14 rounded-lg border-2 px-4 py-2 text-left text-lg font-bold ${
              round.my_choice === i ? "border-stamp bg-stamp text-paper" : "border-fg bg-surface"
            } disabled:cursor-default`}>
            {option}
          </button>
        ))}
        {round.my_choice !== null && !round.revealed && (
          <p className="text-sm font-semibold sm:col-span-2">{fill(t.lockedIn, { name: otherName })}</p>
        )}
      </div>
    );
  }
  if (!round.can_answer) {
    return round.my_answer && !round.revealed ? (
      <p className="text-sm font-semibold">{fill(t.lockedIn, { name: otherName })}</p>
    ) : null;
  }
  const dare = round.choice === "dare";
  return (
    <form className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        send({ t: "answer", value: dare ? text.trim() || null : text });
      }}>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {dare ? t.dareNote : t.yourAnswer}
        <textarea value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder={dare ? "" : t.typeAnswer}
          className="min-h-24 w-full rounded-md border-2 border-fg bg-surface px-3 py-2 text-base leading-relaxed" />
      </label>
      <button type="submit" className={primary} disabled={!dare && !text.trim()}>
        {dare ? t.dareDone : t.send}
      </button>
    </form>
  );
}

function Reveal({ view, round, names, otherName }: { view: GameView; round: GameRound; names: Record<string, string>; otherName: string }) {
  const answers = round.answers ?? {};
  const order = round.answer === "truth_dare" && round.subject ? [round.subject] : view.players.map((p) => p.id);
  let verdict: string | null = null;
  if (round.match !== null && round.subject && round.answer !== "truth_dare") {
    const guesser = round.subject === view.me ? otherName : names[view.me];
    verdict = fill(round.match ? t.guessRight : t.guessWrong, { name: guesser ?? "" });
  } else if (round.match !== null) {
    verdict = round.match ? t.match : t.noMatch;
  }
  return (
    <div className="flip-in flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {order.map((id) => (
          <div key={id} className="rounded-md border-2 border-ink bg-white/60 p-3">
            <p className="text-xs font-extrabold tracking-[0.12em] text-muted uppercase">{names[id]}</p>
            <p className="text-lg font-semibold whitespace-pre-line">{answers[id] || t.noAnswer}</p>
          </div>
        ))}
      </div>
      {verdict && <p className="font-hand text-2xl text-accent-text">{verdict}</p>}
    </div>
  );
}

function Timer({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p role="timer" className={`font-heading text-3xl tabular-nums ${left <= 3 ? "text-accent-text" : ""}`}>
      {left > 0 ? fill(t.secondsLeft, { count: left }) : t.timeUp}
    </p>
  );
}

function EndGame({ send }: { send: (m: Move) => void }) {
  const [sure, setSure] = useState(false);
  return sure ? (
    <span className="flex items-center gap-2 text-sm font-semibold">
      {t.endConfirm}
      <button type="button" className="min-h-12 px-2 font-bold text-accent-text underline" onClick={() => send({ t: "end" })}>
        {t.end}
      </button>
    </span>
  ) : (
    <button type="button" className="min-h-12 px-2 text-sm font-bold text-muted underline" onClick={() => setSure(true)}>
      {t.end}
    </button>
  );
}

// --- results -------------------------------------------------------------------------------

function Results({ view, names }: { view: GameView; names: Record<string, string> }) {
  const s = view.summary;
  if (!s) return null;
  const lines: string[] = [];
  if (s.scored > 0) lines.push(fill(t.matched, { matched: s.matched, scored: s.scored }));
  for (const [id, count] of Object.entries(s.guesses)) {
    if (count > 0) {
      lines.push(id === view.me ? fill(t.youGuessed, { count }) : fill(t.guessed, { name: names[id] ?? "", count }));
    }
  }
  for (const [id, lang] of Object.entries(s.love_languages)) {
    if (lang) {
      lines.push(id === view.me ? fill(t.yourLoveLanguage, { lang }) : fill(t.loveLanguage, { name: names[id] ?? "", lang }));
    }
  }
  return (
    <section className={sheet} aria-labelledby="results-title">
      <h1 id="results-title" className="text-4xl">{t.resultsTitle}</h1>
      <ul className="flex flex-col gap-2 text-xl font-semibold">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="text-sm text-muted">{fill(t.rounds, { count: s.rounds })}</p>
      <Link href="/games" className={`${primary} inline-flex items-center justify-center self-start no-underline`}>
        {t.playAgain}
      </Link>
    </section>
  );
}

// --- chat ----------------------------------------------------------------------------------

function Chat({ chat, me, send }: { chat: ChatMessage[]; me: string; send: (m: Move) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  const [seen, setSeen] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const unread = open ? 0 : Math.max(0, chat.length - seen);

  useEffect(() => {
    const box = list.current;
    if (open && box) box.scrollTop = box.scrollHeight;
  }, [chat, open]);

  return (
    <aside className="flex min-w-0 flex-col gap-2 rounded-md border-2 border-line bg-surface p-3 lg:sticky lg:top-6 lg:self-start" aria-label={t.chat}>
      <button type="button" className="flex min-h-12 items-center justify-between font-bold"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setSeen(chat.length);
        }}>
        <span>
          {t.chat}
          {unread > 0 && (
            <span className="ml-2 rounded-full bg-stamp px-2 py-0.5 text-xs text-paper">{unread}</span>
          )}
        </span>
        <span aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <>
          <ol ref={list} className="flex max-h-72 min-h-24 flex-col gap-2 overflow-y-auto" aria-live="polite">
            {chat.length === 0 && <li className="text-sm text-muted">{t.chatEmpty}</li>}
            {chat.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                m.from === me ? "self-end bg-ink text-paper" : "self-start border-2 border-line bg-white/70"}`}>
                {m.from !== me && <span className="block text-xs font-bold opacity-80">{m.name}</span>}
                {m.text}
              </li>
            ))}
          </ol>
          <form className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              send({ t: "chat", text });
              setText("");
            }}>
            <label className="sr-only" htmlFor="chat-text">{t.chatPlaceholder}</label>
            <input id="chat-text" value={text} maxLength={300} onChange={(e) => setText(e.target.value)}
              placeholder={t.chatPlaceholder} autoComplete="off"
              className="min-h-12 min-w-0 flex-1 rounded-md border-2 border-fg bg-white px-3 text-base" />
            <button type="submit" className="min-h-12 rounded-md bg-ink px-4 font-bold text-paper">{t.send}</button>
          </form>
          <p className="text-xs text-muted">{t.chatPrivacy}</p>
        </>
      )}
    </aside>
  );
}
