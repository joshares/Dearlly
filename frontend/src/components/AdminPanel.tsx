"use client";

import { useCallback, useEffect, useState } from "react";

import { getMessages } from "@/i18n";
import { ApiError, api, type MyProfile } from "@/lib/api";
import { lagosDate, lagosDateTime } from "@/lib/dates";

const t = getMessages().admin;

type Tab = keyof typeof t.tabs;
const TABS = Object.keys(t.tabs) as Tab[];

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

const card = "flex flex-col gap-3 rounded-md border-2 border-line bg-surface p-4";
const smallButton = "min-h-12 rounded-md border-2 border-fg bg-surface px-4 text-sm font-bold disabled:opacity-50";
const input = "min-h-12 w-full min-w-0 rounded-md border-2 border-fg bg-white px-3 text-base";

/** dearlly.app/admin: only for accounts marked admin on the server. */
export function AdminPanel() {
  const [me, setMe] = useState<MyProfile | null | "no">(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    api<MyProfile>("/me")
      .then((found) => setMe(found.is_admin ? found : "no"))
      .catch(() => setMe("no"));
  }, []);

  if (me === null) return <p className="py-16 text-center text-muted">{t.loading}</p>;
  if (me === "no") return <p className="py-16 text-center text-lg">{t.notFound}</p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl">{t.title}</h1>
      <nav aria-label={t.title} className="flex flex-wrap gap-2">
        {TABS.map((key) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}
            className={`min-h-12 rounded-full border-2 px-4 font-bold ${tab === key ? "border-fg bg-fg text-bg" : "border-line"}`}>
            {t.tabs[key]}
          </button>
        ))}
      </nav>
      {tab === "overview" && <Overview />}
      {tab === "reports" && <Reports />}
      {tab === "community" && <Community />}
      {tab === "questions" && <Questions />}
      {tab === "users" && <Accounts />}
    </div>
  );
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<T>(path)
      .then((found) => {
        setData(found);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.detail : t.error));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

// --- overview ------------------------------------------------------------------------------

type OverviewData = {
  users: { total: number; last_7_days: number; last_24_hours: number };
  letters: {
    total: number; last_7_days: number; by_type: Record<string, number>; opened: number; replied: number;
    emailed: number; secret_admirer: number; taken_back: number;
  };
  games: { total: number; finished: number; playing_now: number; last_7_days: number };
  photos: number;
  open_reports: number;
};

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={card}>
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="font-heading text-4xl leading-none">{value}</span>
      {sub && <span className="text-sm text-muted">{sub}</span>}
    </div>
  );
}

function Overview() {
  const { data, error } = useLoad<OverviewData>("/admin/overview");
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p className="text-muted">{t.loading}</p>;
  const l = data.letters;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Stat label={t.users} value={data.users.total} sub={`${data.users.last_7_days} ${t.newWeek} · ${data.users.last_24_hours} ${t.newDay}`} />
      <Stat label={t.letters} value={l.total}
        sub={`${l.last_7_days} ${t.newWeek} · ${pct(l.opened, l.total)} ${t.opened} · ${pct(l.replied, l.total)} ${t.replied}`} />
      <Stat label={t.openReports} value={data.open_reports} />
      <Stat label={t.games} value={data.games.total}
        sub={`${data.games.finished} ${t.finished} · ${data.games.playing_now} ${t.playingNow} · ${data.games.last_7_days} ${t.newWeek}`} />
      <Stat label={t.photos} value={data.photos} />
      <div className={card}>
        <span className="text-sm font-semibold text-muted">{t.letters}</span>
        <ul className="flex flex-col gap-1 text-sm">
          {Object.entries(l.by_type).map(([type, count]) => (
            <li key={type} className="flex justify-between gap-3">
              <span>{t.types[type as keyof typeof t.types] ?? type}</span>
              <strong>{count}</strong>
            </li>
          ))}
          <li className="flex justify-between gap-3"><span>{t.emailed}</span><strong>{l.emailed}</strong></li>
          <li className="flex justify-between gap-3"><span>{t.secret}</span><strong>{l.secret_admirer}</strong></li>
          <li className="flex justify-between gap-3"><span>{t.takenBack}</span><strong>{l.taken_back}</strong></li>
        </ul>
      </div>
    </div>
  );
}

// --- reports -------------------------------------------------------------------------------

type ReportData = {
  id: string; reason: keyof typeof t.reasons; note: string | null; created_at: string; status: string;
  resolution: "taken_down" | "dismissed" | null; sender: string | null; sender_reports: number;
  post: {
    id: string; author: string; caption: string; photo: { small_url: string } | null; like_count: number;
    created_at: string; removed: boolean;
  } | null;
  letter: {
    id: string; type: string; sender_name: string; recipient_name: string; secret_admirer: boolean;
    content: Record<string, string>; photo: { small_url: string } | null; created_at: string; taken_down: boolean;
  } | null;
};

function Reports() {
  const [show, setShow] = useState<"open" | "resolved">("open");
  const { data, error, reload } = useLoad<ReportData[]>(`/admin/reports?show=${show}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {(["open", "resolved"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}
            className={`min-h-12 rounded-md border-2 px-4 text-sm font-bold ${show === s ? "border-fg bg-fg text-bg" : "border-line"}`}>
            {s === "open" ? t.openTab : t.resolvedTab}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {data && data.length === 0 && <p className="text-muted">{t.noReports}</p>}
      {data?.map((report) => <ReportCard key={report.id} report={report} onDone={reload} />)}
    </div>
  );
}

function ReportCard({ report, onDone }: { report: ReportData; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const letter = report.letter;

  async function act(action: "takedown" | "dismiss") {
    setBusy(true);
    try {
      await api(`/admin/reports/${report.id}/${action}`, { method: "POST" });
      onDone();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-lg">{t.reasons[report.reason] ?? report.reason}</strong>
        <span className="text-sm text-muted">{lagosDateTime(report.created_at)}</span>
      </div>
      {report.note && <p><span className="font-semibold">{t.note}:</span> {report.note}</p>}
      <p className="text-sm">
        <span className="font-semibold">{t.sender}:</span> {report.sender ?? "–"}
        {report.sender_reports > 1 && <span className="font-bold text-accent-text"> · {fill(t.senderReports, { count: report.sender_reports })}</span>}
      </p>
      {report.post ? (
        <div className="flex flex-col gap-2 rounded-md border-2 border-dashed border-line bg-white/60 p-3 text-sm">
          <p className="font-semibold">{t.postReport} · {report.post.author} · {report.post.like_count} ❤️</p>
          {report.post.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a private, signed link
            <img src={report.post.photo.small_url} alt="" className="max-h-60 w-auto max-w-full self-start rounded border-2 border-ink" />
          )}
          <p className="whitespace-pre-line">{report.post.caption}</p>
        </div>
      ) : letter ? (
        <div className="flex flex-col gap-2 rounded-md border-2 border-dashed border-line bg-white/60 p-3 text-sm">
          <p className="font-semibold">
            {t.types[letter.type as keyof typeof t.types] ?? letter.type} · {letter.sender_name} → {letter.recipient_name}
            {letter.secret_admirer && <span className="text-accent-text"> · {t.secretTag}</span>}
          </p>
          {Object.entries(letter.content).map(([k, v]) => (
            <p key={k} className="whitespace-pre-line"><span className="text-muted">{k}:</span> {v}</p>
          ))}
          {letter.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- a private, signed link
            <img src={letter.photo.small_url} alt="" className="max-h-60 w-auto max-w-full self-start rounded border-2 border-ink" />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">{t.letterGone}</p>
      )}
      {report.status === "open" ? (
        confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-dashed border-stamp p-3">
            <span className="text-sm font-semibold">{t.takeDownConfirm}</span>
            <button type="button" disabled={busy} className="min-h-12 rounded-md bg-stamp px-4 text-sm font-bold text-paper"
              onClick={() => act("takedown")}>{t.yes}</button>
            <button type="button" className={smallButton} onClick={() => setConfirming(false)}>{t.no}</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || (report.post ? report.post.removed : !letter || letter.taken_down)}
              className="min-h-12 rounded-md bg-stamp px-4 text-sm font-bold text-paper disabled:opacity-50"
              onClick={() => setConfirming(true)}>{t.takeDown}</button>
            <button type="button" disabled={busy} className={smallButton} onClick={() => act("dismiss")}>{t.dismiss}</button>
          </div>
        )
      ) : (
        <p className="text-sm font-bold">{report.resolution === "taken_down" ? t.takenDown : t.dismissed}</p>
      )}
    </article>
  );
}

// --- community -----------------------------------------------------------------------------

type AdminPost = {
  id: string; author: string; caption: string; photo: { small_url: string } | null; like_count: number;
  reports: number; created_at: string; removed: boolean; top: boolean;
};
type AdminPosts = { items: AdminPost[]; top_picked: boolean; page: number; pages: number };

function Community() {
  const [show, setShow] = useState<keyof typeof t.postsShow>("all");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad<AdminPosts>(`/admin/posts?show=${show}&page=${page}`);

  async function act(path: string, body: unknown) {
    await api(path, { method: "POST", body });
    reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(t.postsShow) as (keyof typeof t.postsShow)[]).map((s) => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => { setShow(s); setPage(1); }}
            className={`min-h-12 rounded-md border-2 px-4 text-sm font-bold ${show === s ? "border-fg bg-fg text-bg" : "border-line"}`}>
            {t.postsShow[s]}
          </button>
        ))}
      </div>
      {data && <p className="text-sm text-muted">{data.top_picked ? t.topPickedNote : t.topLikesNote}</p>}
      {error && <p role="alert">{error}</p>}
      {data?.items.length === 0 && <p className="text-muted">{t.noPosts}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data?.items.map((post) => (
          <li key={post.id} className={`${card} ${post.removed ? "opacity-60" : ""}`}>
            {post.photo && (
              // eslint-disable-next-line @next/next/no-img-element -- a private, signed link
              <img src={post.photo.small_url} alt="" loading="lazy" className="aspect-square w-full rounded border-2 border-ink object-cover" />
            )}
            <p className="text-sm font-bold">
              {post.author} · {lagosDate(post.created_at)}
              {post.top && <span className="text-accent-text"> · 🏆 {t.topNow}</span>}
            </p>
            <p className="text-sm whitespace-pre-line">{post.caption}</p>
            <p className="text-sm">
              {fill(t.postLikes, { count: post.like_count })} ·{" "}
              <span className={post.reports ? "font-bold text-accent-text" : ""}>{fill(t.postReports, { count: post.reports })}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={smallButton} onClick={() => act(`/admin/posts/${post.id}/removed`, { removed: !post.removed })}>
                {post.removed ? t.restorePost : t.removePost}
              </button>
              {!post.removed && (post.top && data.top_picked ? (
                <button type="button" className={smallButton} onClick={() => act("/admin/top", { post_id: null })}>{t.backToLikes}</button>
              ) : !post.top ? (
                <button type="button" className={smallButton} onClick={() => act("/admin/top", { post_id: post.id })}>🏆 {t.makeTop}</button>
              ) : null)}
            </div>
          </li>
        ))}
      </ul>
      {data && data.pages > 1 && (
        <nav className="flex items-center justify-between gap-2">
          <button type="button" className={smallButton} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t.newer}</button>
          <span className="text-sm text-muted">{data.page} / {data.pages}</span>
          <button type="button" className={smallButton} disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>{t.older}</button>
        </nav>
      )}
    </div>
  );
}

// --- questions -----------------------------------------------------------------------------

type QuestionData = {
  key: string; game: string; text: string; options: string[]; levels: string[]; depth: number;
  shown: number; skipped: number; thumbs_up: number; thumbs_down: number; retired: boolean; weakness: number;
};
type QuestionsPage = { items: QuestionData[]; total: number; page: number; pages: number };
type GameFormat = { key: string; name: string };

function Questions() {
  const [games, setGames] = useState<GameFormat[]>([]);
  const [game, setGame] = useState("");
  const [sort, setSort] = useState<keyof typeof t.sorts>("weakest");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ sort, page: String(page) });
  if (game) params.set("game", game);
  if (search) params.set("q", search);
  const { data, error, reload } = useLoad<QuestionsPage>(`/admin/questions?${params}`);

  useEffect(() => {
    api<GameFormat[]>("/games/formats").then((found) => setGames(found.filter((g) => g.key !== "mix"))).catch(() => undefined);
  }, []);

  async function setRetired(key: string, retired: boolean) {
    await api(`/admin/questions/${key}/retired`, { method: "POST", body: { retired } });
    reload();
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(query.trim()); }}>
        <label className="sr-only" htmlFor="q-search">{t.searchQuestions}</label>
        <input id="q-search" className={input} placeholder={t.searchQuestions} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className={smallButton}>{t.search}</button>
      </form>
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label={t.allGames} className={input} value={game} onChange={(e) => { setPage(1); setGame(e.target.value); }}>
          <option value="">{t.allGames}</option>
          {games.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
        <select aria-label={t.sorts.weakest} className={input} value={sort} onChange={(e) => { setPage(1); setSort(e.target.value as keyof typeof t.sorts); }}>
          {(Object.keys(t.sorts) as (keyof typeof t.sorts)[]).map((s) => <option key={s} value={s}>{t.sorts[s]}</option>)}
        </select>
      </div>
      <p className="text-sm text-muted">{t.weakHint}</p>
      {error && <p role="alert">{error}</p>}
      <ul className="flex flex-col gap-2">
        {data?.items.map((q) => (
          <li key={q.key} className={`${card} ${q.retired ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-bold tracking-wide text-muted uppercase">
              <span>{q.game} · {q.levels.join(", ")} · depth {q.depth}</span>
              {q.retired && <span className="text-accent-text">{t.retiredTag}</span>}
            </div>
            <p className="font-semibold">{q.text}</p>
            {q.options.length > 0 && <p className="text-sm text-muted">{q.options.join(" · ")}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                {q.shown} {t.shown} · {q.skipped} {t.skipped} · 👍 {q.thumbs_up} · 👎 {q.thumbs_down}
              </span>
              <button type="button" className={smallButton} onClick={() => setRetired(q.key, !q.retired)}>
                {q.retired ? t.restore : t.retire}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {data && (
        <nav className="flex items-center justify-between gap-2">
          <button type="button" className={smallButton} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t.newer}</button>
          <span className="text-sm text-muted">{fill(t.pageOf, { page: data.page, pages: data.pages, total: data.total })}</span>
          <button type="button" className={smallButton} disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>{t.older}</button>
        </nav>
      )}
    </div>
  );
}

// --- accounts ------------------------------------------------------------------------------

type AccountData = {
  id: string; username: string; display_name: string | null; email: string; created_at: string;
  last_login_at: string | null; is_admin: boolean; letters: number; games: number; reports_against: number;
  secret_letters_blocked: number;
};

function Accounts() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<AccountData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function look(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    try {
      setFound(await api<AccountData[]>(`/admin/users?q=${encodeURIComponent(query.trim())}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={look}>
        <label className="sr-only" htmlFor="u-search">{t.searchAccounts}</label>
        <input id="u-search" className={input} placeholder={t.searchAccounts} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className={smallButton}>{t.search}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {found && found.length === 0 && <p className="text-muted">{t.noAccounts}</p>}
      <ul className="flex flex-col gap-2">
        {found?.map((u) => (
          <li key={u.id} className={card}>
            <p className="font-bold">
              @{u.username}
              {u.display_name && <span className="font-normal text-muted"> · {u.display_name}</span>}
              {u.is_admin && <span className="text-accent-text"> · {t.adminTag}</span>}
            </p>
            <p className="text-sm break-all">{u.email}</p>
            <p className="text-sm text-muted">
              {fill(t.joined, { date: lagosDate(u.created_at) })} · {t.lastLogin.replace("{date}", u.last_login_at ? lagosDate(u.last_login_at) : t.never)}
            </p>
            <p className="text-sm">
              {fill(t.accountLetters, { count: u.letters })} · {fill(t.accountGames, { count: u.games })} ·{" "}
              <span className={u.reports_against ? "font-bold text-accent-text" : ""}>{fill(t.accountReports, { count: u.reports_against })}</span> ·{" "}
              {fill(t.accountBlocks, { count: u.secret_letters_blocked })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
