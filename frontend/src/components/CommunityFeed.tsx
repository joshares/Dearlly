"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { type LetterPhoto, photoImgProps } from "@/components/LetterCard";
import { draftPhoto, NO_PHOTO, PhotoField, type PhotoValue } from "@/components/PhotoField";
import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";
import { lagosDate } from "@/lib/dates";

const t = getMessages().community;
const CAPTION_MAX = 280;

type Reason = keyof typeof t.reasons;
const REASONS = Object.keys(t.reasons) as Reason[];

export type Post = {
  id: string;
  author: { username: string; display_name: string | null };
  caption: string;
  photo: { url: string; small_url: string; width: number; height: number } | null;
  like_count: number;
  liked: boolean;
  mine: boolean;
  created_at: string;
};
type Feed = { items: Post[]; next_before: string | null };
type Top = { post: Post | null; picked: boolean };

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

function asPhoto(post: Post): LetterPhoto | null {
  const p = post.photo;
  return p ? { url: p.url, smallUrl: p.small_url, width: p.width, height: p.height } : null;
}

/** /community: the top post of the week, then everyone's stamps, newest first. */
export function CommunityFeed() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [top, setTop] = useState<Top | null>(null);
  const [more, setMore] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const failed = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?next=${encodeURIComponent("/community")}`);
      } else {
        setError(err instanceof ApiError ? err.detail : t.error);
      }
    },
    [router],
  );

  useEffect(() => {
    api<Feed>("/community/feed")
      .then((feed) => {
        setPosts(feed.items);
        setNext(feed.next_before);
      })
      .catch(failed);
    api<Top>("/community/top").then(setTop).catch(() => undefined);
  }, [failed]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const feed = await api<Feed>(`/community/feed?before=${encodeURIComponent(next)}`);
      setPosts((all) => [...(all ?? []), ...feed.items]);
      setNext(feed.next_before);
    } catch (err) {
      failed(err);
    } finally {
      setMore(false);
    }
  }

  // One post changed (liked, deleted): update it wherever it shows (feed and top).
  const changed = (id: string, update: Partial<Post> | null) => {
    setPosts((all) =>
      (all ?? []).flatMap((p) => (p.id !== id ? [p] : update === null ? [] : [{ ...p, ...update }])),
    );
    setTop((current) =>
      current?.post?.id === id
        ? { ...current, post: update === null ? null : { ...current.post, ...update } }
        : current,
    );
  };

  const topId = top?.post?.id;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
        <p className="max-w-2xl text-lg text-muted">{t.lead}</p>
        <p className="text-sm text-muted">{t.membersOnly}</p>
      </header>

      {composing ? (
        <Composer
          onPosted={(post) => {
            setPosts((all) => [post, ...(all ?? [])]);
            setComposing(false);
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <button type="button" onClick={() => setComposing(true)}
          className="min-h-14 self-start rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)]">
          {t.postButton}
        </button>
      )}

      {top?.post && (
        <section aria-labelledby="top-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="top-title" className="text-3xl">🏆 {t.topTitle}</h2>
            <span className="text-sm font-semibold text-muted">{top.picked ? t.topPicked : t.topLikes}</span>
          </div>
          <PostCard post={top.post} featured onChange={changed} />
        </section>
      )}

      {error && <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">{error}</p>}
      {posts === null && !error && <p className="font-hand py-8 text-center text-lg text-muted">{t.loading}</p>}
      {posts?.length === 0 && <p className="text-muted">{t.empty}</p>}

      <ul className="grid grid-cols-[minmax(0,1fr)] gap-8 sm:grid-cols-2">
        {posts?.filter((p) => p.id !== topId).map((post) => (
          <li key={post.id} className="min-w-0">
            <PostCard post={post} onChange={changed} />
          </li>
        ))}
      </ul>

      {next && (
        <button type="button" onClick={loadMore} disabled={more}
          className="min-h-12 self-center rounded-lg border-2 border-fg px-5 font-bold disabled:opacity-50">
          {more ? t.loadingMore : t.loadMore}
        </button>
      )}
    </div>
  );
}

// --- one stamp -----------------------------------------------------------------------------

/** The photo's width:height, kept between portrait 4:5 and wide 16:9, so the card never jumps. */
function shape(photo: LetterPhoto): string {
  const ratio = photo.width && photo.height ? photo.width / photo.height : 1;
  return String(Math.min(16 / 9, Math.max(4 / 5, ratio)));
}

export function PostCard({
  post,
  featured = false,
  onChange,
}: {
  post: Post;
  featured?: boolean;
  onChange: (id: string, update: Partial<Post> | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"none" | "menu" | "report" | "delete">("none");
  const photo = asPhoto(post);

  async function toggleLike() {
    if (busy) return;
    setBusy(true);
    // Shown at once; the server's count replaces it.
    onChange(post.id, { liked: !post.liked, like_count: post.like_count + (post.liked ? -1 : 1) });
    try {
      const done = await api<{ like_count: number; liked: boolean }>(`/community/posts/${post.id}/like`, {
        method: post.liked ? "DELETE" : "POST",
      });
      onChange(post.id, done);
    } catch {
      onChange(post.id, { liked: post.liked, like_count: post.like_count });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/community/posts/${post.id}`, { method: "DELETE" });
      onChange(post.id, null);
    } catch {
      setBusy(false);
    }
  }

  return (
    <article className={`drop-shadow-[4px_6px_0_var(--shadow)] ${featured ? "" : "even:rotate-1"}`}>
      <div className="stamp-edge bg-[#FBF6EE]">
        <div className={`flex flex-col gap-3 border-2 bg-surface p-3 ${featured ? "border-stamp" : "border-ink"}`}>
          {photo && (
            <div className="overflow-hidden border-2 border-ink bg-white" style={{ aspectRatio: shape(photo) }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed link */}
              <img
                {...photoImgProps(photo, featured ? "(max-width: 640px) 90vw, 640px" : "(max-width: 640px) 90vw, 420px")}
                loading={featured ? "eager" : "lazy"}
                alt={fill(t.photoAlt, { username: post.author.username })}
                className="block h-full w-full object-cover"
              />
            </div>
          )}
          <p className={`whitespace-pre-line ${featured ? "font-hand text-xl leading-loose" : "font-hand text-lg leading-loose"}`}>
            {post.caption}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-muted">
              {fill(t.by, { username: post.author.username })} · {lagosDate(post.created_at)}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={toggleLike} aria-pressed={post.liked}
                aria-label={post.liked ? t.unlike : t.like}
                className={`flex min-h-12 min-w-12 items-center justify-center gap-1 rounded-full border-2 px-3 font-bold ${
                  post.liked ? "border-stamp text-accent-text" : "border-line"}`}>
                <span aria-hidden="true">{post.liked ? "❤️" : "🤍"}</span>
                <span>{post.like_count}</span>
              </button>
              <button type="button" aria-label={t.more} aria-expanded={panel !== "none"}
                onClick={() => setPanel(panel === "none" ? "menu" : "none")}
                className="flex min-h-12 min-w-12 items-center justify-center rounded-full text-xl font-bold">
                ⋯
              </button>
            </span>
          </div>
          {panel === "menu" && (
            <div className="flex flex-wrap gap-2">
              {post.mine ? (
                <button type="button" className="min-h-12 rounded-md border-2 border-stamp px-4 text-sm font-bold text-accent-text"
                  onClick={() => setPanel("delete")}>{t.delete}</button>
              ) : (
                <button type="button" className="min-h-12 rounded-md border-2 border-fg px-4 text-sm font-bold"
                  onClick={() => setPanel("report")}>{t.report}</button>
              )}
            </div>
          )}
          {panel === "delete" && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-dashed border-stamp p-3">
              <span className="text-sm font-semibold">{t.deleteConfirm}</span>
              <button type="button" disabled={busy} onClick={remove}
                className="min-h-12 rounded-md bg-stamp px-4 text-sm font-bold text-paper disabled:opacity-50">{t.deleteYes}</button>
              <button type="button" onClick={() => setPanel("none")}
                className="min-h-12 rounded-md border-2 border-fg px-4 text-sm font-bold">{t.cancel}</button>
            </div>
          )}
          {panel === "report" && <ReportPost postId={post.id} onClose={() => setPanel("none")} />}
        </div>
      </div>
    </article>
  );
}

function ReportPost({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      setError(t.reportPick);
      return;
    }
    setBusy(true);
    try {
      await api(`/community/posts/${postId}/report`, { method: "POST", body: { reason, note: note.trim() || null } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t.error);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p role="status" className="text-sm font-semibold">{t.reported}</p>;
  return (
    <form onSubmit={send} className="flex flex-col gap-2 rounded-md border-2 border-dashed border-line p-3">
      <p className="font-bold">{t.reportTitle}</p>
      <p className="text-sm text-muted">{t.reportLead}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.reportTitle}>
        {REASONS.map((r) => (
          <label key={r} className={`flex min-h-12 cursor-pointer items-center rounded-full border-2 px-3 text-sm font-bold ${
            reason === r ? "border-fg bg-fg text-bg" : "border-line"}`}>
            <input type="radio" name="reason" className="sr-only" checked={reason === r} onChange={() => setReason(r)} />
            {t.reasons[r]}
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.reportNote}
        <input value={note} maxLength={280} onChange={(e) => setNote(e.target.value)}
          className="min-h-12 w-full rounded-md border-2 border-fg bg-white px-3 text-base" />
      </label>
      {error && <p role="alert" className="text-sm font-semibold text-accent-text">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-12 rounded-md bg-ink px-4 text-sm font-bold text-paper disabled:opacity-50">
          {t.reportSend}
        </button>
        <button type="button" onClick={onClose} className="min-h-12 rounded-md border-2 border-fg px-4 text-sm font-bold">{t.cancel}</button>
      </div>
    </form>
  );
}

// --- posting -------------------------------------------------------------------------------

function Composer({ onPosted, onCancel }: { onPosted: (post: Post) => void; onCancel: () => void }) {
  const [photo, setPhoto] = useState<PhotoValue>(NO_PHOTO);
  const [caption, setCaption] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = draftPhoto(photo);

  useEffect(() => {
    api<{ enabled: boolean }>("/photos/status")
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onPosted(await api<Post>("/community/posts", { method: "POST", body: { photo_id: photo.photoId, caption } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t.error);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={post} className="letter-sheet flex flex-col gap-4 rounded-sm py-6 pr-5 pl-11 md:max-w-xl md:pl-16">
      <h2 className="text-3xl">{t.composerTitle}</h2>
      {enabled === false && <p className="font-semibold">{t.photosOff}</p>}
      <PhotoField value={photo} onChange={setPhoto} loggedIn next="/community" labelText={t.photoLabel} hintText={t.photoHint} />
      {preview && (
        <div className="max-w-xs overflow-hidden border-2 border-ink bg-white" style={{ aspectRatio: shape(preview) }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed link */}
          <img {...photoImgProps(preview, "320px")} alt="" className="block h-full w-full object-cover" />
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        <span className="flex justify-between">
          {t.captionLabel}
          <span className="font-normal text-muted">{caption.length}/{CAPTION_MAX}</span>
        </span>
        <textarea value={caption} maxLength={CAPTION_MAX} onChange={(e) => setCaption(e.target.value)}
          placeholder={t.captionPlaceholder}
          className="min-h-24 w-full rounded-md border-2 border-fg bg-surface px-3 py-2 text-base leading-relaxed" />
        <span className="font-normal text-muted">{t.captionHint}</span>
      </label>
      {error && <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !photo.photoId || !caption.trim()}
          className="min-h-14 rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-50 disabled:shadow-none">
          {busy ? t.posting : t.post}
        </button>
        <button type="button" onClick={onCancel} className="min-h-14 rounded-lg border-2 border-fg px-5 font-bold">{t.cancel}</button>
      </div>
    </form>
  );
}
