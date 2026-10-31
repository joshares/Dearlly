"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getMessages } from "@/i18n";
import { ApiError, api, peek, remember } from "@/lib/api";

const t = getMessages().games;

type Level = keyof typeof t.levels;
const LEVELS = Object.keys(t.levels) as Level[];
const ROUNDS = [5, 10, 15, 20];
// Game codes use these letters and numbers only (no O/0 or I/1), six of them.
const CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g;

/** Glide to the next step, so people see where to go (no glide for "reduce motion"). */
function showNext(target: HTMLElement | null) {
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (typeof target?.scrollIntoView === "function") {
    target.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
  }
}

type GameFormat = {
  key: string;
  name: string;
  blurb: string;
  levels: { key: Level; questions: number }[];
};

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

/** Pick a game, a level and how many rounds, then create it and invite someone. */
export function GameLibrary({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  const [formats, setFormats] = useState<GameFormat[] | null>(() => peek<GameFormat[]>("/games/formats") ?? null);
  const [game, setGame] = useState("mix");
  const [level, setLevel] = useState<Level>("romantic");
  const [rounds, setRounds] = useState(10);
  const [intenseOk, setIntenseOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levelStep = useRef<HTMLElement>(null);
  const intenseStep = useRef<HTMLLabelElement>(null);
  const createStep = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<GameFormat[]>("/games/formats")
      .then((found) => {
        remember("/games/formats", found);
        setFormats(found);
      })
      .catch(() => setError(t.error));
  }, []);

  const chosen = formats?.find((f) => f.key === game);
  const available = chosen?.levels.find((l) => l.key === level)?.questions ?? 0;
  const roundsAllowed = ROUNDS.filter((r) => r <= available);
  const pickedRounds = roundsAllowed.includes(rounds) ? rounds : (roundsAllowed.at(-1) ?? 3);

  async function create() {
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent("/games")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await api<{ code: string }>("/games", {
        method: "POST",
        body: { format: game, intensity: level, rounds: Math.min(pickedRounds, available) },
      });
      router.push(`/play/${made.code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?next=${encodeURIComponent("/games")}`);
        return;
      }
      setError(err instanceof ApiError ? err.detail : t.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
        <p className="max-w-2xl text-lg text-muted">{t.lead}</p>
      </header>

      <JoinByCode />

      <section aria-labelledby="pick-game" className="flex flex-col gap-4">
        <h2 id="pick-game" className="text-2xl">{t.orCreate}</h2>
        <p className="-mt-2 font-semibold">{t.pickGame}</p>
        {!formats ? (
          <ul className="grid animate-pulse gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="h-24 rounded-md bg-line/20" />
            ))}
          </ul>
        ) : (
          <div role="radiogroup" aria-labelledby="pick-game" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {formats.map((f) => (
              <label
                key={f.key}
                className={`flex min-h-24 cursor-pointer flex-col gap-1 rounded-md border-2 bg-surface p-4 ${
                  game === f.key ? "border-stamp shadow-[4px_4px_0_var(--color-ink)]" : "border-line"
                }`}
              >
                <input type="radio" name="game" value={f.key} className="sr-only" checked={game === f.key}
                  onChange={() => setGame(f.key)}
                  // A click, not a change: picking the game already chosen still moves on.
                  onClick={() => showNext(levelStep.current)} />
                <span className="text-xl font-heading">{f.name}</span>
                <span className="text-sm text-muted">{f.blurb}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section ref={levelStep} aria-labelledby="pick-level" className="flex scroll-mt-6 flex-col gap-4">
        <h2 id="pick-level" className="text-2xl">{t.pickLevel}</h2>
        <div role="radiogroup" aria-labelledby="pick-level" className="grid gap-3 sm:grid-cols-2">
          {LEVELS.map((l) => {
            const count = chosen?.levels.find((x) => x.key === l)?.questions ?? 0;
            return (
              <label key={l}
                className={`flex min-h-16 cursor-pointer flex-col gap-0.5 rounded-md border-2 bg-surface p-3 ${
                  level === l ? "border-stamp" : "border-line"} ${count < 3 ? "opacity-50" : ""}`}>
                <input type="radio" name="level" value={l} className="sr-only" checked={level === l}
                  disabled={count < 3} onChange={() => setLevel(l)}
                  onClick={() => window.setTimeout(() => showNext(l === "intense" ? intenseStep.current : createStep.current), 50)} />
                <span className="font-bold">{t.levels[l]}</span>
                <span className="text-sm text-muted">{t.levelHints[l]}</span>
              </label>
            );
          })}
        </div>
        {level === "intense" && (
          <label ref={intenseStep} className="flex min-h-12 items-start gap-3 rounded-md border-2 border-dashed border-stamp p-3">
            <input type="checkbox" className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-stamp)]" checked={intenseOk}
              onChange={(e) => {
                setIntenseOk(e.target.checked);
                if (e.target.checked) showNext(createStep.current);
              }} />
            <span className="font-semibold">{t.intenseConfirm}</span>
          </label>
        )}
      </section>

      <section aria-labelledby="pick-rounds" className="flex flex-col gap-3">
        <h2 id="pick-rounds" className="text-2xl">{t.roundsLabel}</h2>
        <div role="radiogroup" aria-labelledby="pick-rounds" className="flex flex-wrap gap-2">
          {ROUNDS.map((r) => (
            <label key={r}
              className={`flex min-h-12 min-w-14 cursor-pointer items-center justify-center rounded-full border-2 px-4 font-bold ${
                pickedRounds === r ? "border-fg bg-fg text-bg" : "border-line"} ${r > available ? "opacity-40" : ""}`}>
              <input type="radio" name="rounds" value={r} className="sr-only" checked={pickedRounds === r}
                disabled={r > available} onChange={() => setRounds(r)} />
              {r}
            </label>
          ))}
        </div>
      </section>

      <div ref={createStep} className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">{error}</p>
        )}
        <button type="button" onClick={create}
          disabled={busy || !formats || available < 3 || (level === "intense" && !intenseOk)}
          className="min-h-14 rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-50 disabled:shadow-none sm:self-start">
          {busy ? t.creating : t.create}
        </button>
        {!loggedIn && <p className="text-sm text-muted">{t.needsAccount}</p>}
        {chosen && <p className="text-sm text-muted">{fill(t.questionsCount, { count: available })}</p>}
      </div>
    </div>
  );
}

/** "Have a code?": straight into a game someone else created. */
function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3 rounded-md border-2 border-dashed border-line bg-surface p-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) router.push(`/play/${code}`);
      }}
    >
      <div>
        <h2 className="text-2xl">{t.joinHeading}</h2>
        <p className="text-sm text-muted">{t.joinLead}</p>
      </div>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="game-code">{t.joinLabel}</label>
        <input
          id="game-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(CODE_CHARS, "").slice(0, 6))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="ABC234"
          className="min-h-12 w-full min-w-0 flex-1 rounded-md border-2 border-fg bg-white px-3 font-heading text-2xl tracking-[0.15em] uppercase"
        />
        <button type="submit" disabled={code.length !== 6}
          className="min-h-12 shrink-0 rounded-md bg-ink px-5 font-bold text-paper disabled:opacity-50">
          {t.joinButton}
        </button>
      </div>
    </form>
  );
}
