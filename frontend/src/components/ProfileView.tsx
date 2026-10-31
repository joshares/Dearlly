"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SentLetters } from "@/components/SentLetters";
import { getMessages } from "@/i18n";
import { ApiError, api, forgetLogin, type MyProfile, peek, remember } from "@/lib/api";

const t = getMessages().profile;

export function ProfileView() {
  const router = useRouter();
  // Shown at once if this tab already loaded it; a fresh copy replaces it quietly.
  const [me, setMe] = useState<MyProfile | null>(() => peek<MyProfile>("/me") ?? null);
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api<MyProfile>("/me")
      .then((profile) => {
        remember("/me", profile);
        setMe(profile);
        setDisplayName(profile.display_name ?? "");
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent("/profile")}`);
        }
        else setError(err instanceof ApiError ? err.detail : "Something went wrong.");
      });
  }, [router]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const updated = await api<MyProfile>("/me", {
        method: "PATCH",
        body: { display_name: displayName || null },
      });
      remember("/me", updated);
      setMe(updated);
      setStatus("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
      setStatus("idle");
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!me) return;
    setPasswordStatus("saving");
    setError(null);
    try {
      await api("/me/password", {
        method: "POST",
        body: {
          current_password: me.has_password ? currentPassword : null,
          new_password: newPassword,
        },
      });
      remember("/me", { ...me, has_password: true });
      setMe({ ...me, has_password: true });
      setCurrentPassword("");
      setNewPassword("");
      setPasswordStatus("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
      setPasswordStatus("idle");
    }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    setDeleting(true);
    setError(null);
    try {
      await api("/me/delete", { method: "POST", body: { confirm_username: confirmName } });
      forgetLogin();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
      setDeleting(false);
    }
  }

  async function logOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    forgetLogin();
    router.replace("/login");
    router.refresh();
  }

  if (!me) {
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <ProfileSkeleton label={t.loading} />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl leading-tight md:text-5xl">{t.title}</h1>
        {me.is_admin && (
          <Link href="/admin" className="inline-flex min-h-12 items-center rounded-full border-2 border-stamp px-5 font-bold text-accent-text no-underline">
            {t.adminLink}
          </Link>
        )}
      </div>
      <dl className="flex flex-col gap-3 rounded-md border-2 border-line bg-surface p-4">
        <div>
          <dt className="text-sm text-muted">{t.usernameLabel}</dt>
          <dd className="text-lg font-bold">@{me.username}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t.emailLabel}</dt>
          <dd className="break-all">
            {me.email} <span className="block text-sm text-muted">{t.emailPrivate}</span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t.planLabel}</dt>
          <dd>{t.planFree}</dd>
        </div>
      </dl>

      <SentLetters perPage={3} />

      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t.displayNameLabel}
          <input
            className="min-h-12 rounded-md border-2 border-fg bg-surface px-3 text-base"
            name="display_name"
            maxLength={40}
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setStatus("idle");
            }}
          />
        </label>
        <button
          type="submit"
          disabled={status === "saving"}
          className="min-h-12 rounded-md border-2 border-fg px-5 font-bold"
        >
          {status === "saving" ? t.saving : status === "saved" ? t.saved : t.save}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">
          {error}
        </p>
      )}

      <form
        onSubmit={savePassword}
        aria-labelledby="password-title"
        className="flex flex-col gap-3 border-t-2 border-dashed border-line pt-5"
      >
        <h2 id="password-title" className="text-2xl">
          {t.passwordTitle}
        </h2>
        <p className="text-sm text-muted">{me.has_password ? t.passwordSet : t.passwordNone}</p>
        {me.has_password && (
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t.currentPasswordLabel}
            <input
              className="min-h-12 rounded-md border-2 border-fg bg-surface px-3 text-base"
              type="password"
              name="current_password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t.newPasswordLabel}
          <input
            className="min-h-12 rounded-md border-2 border-fg bg-surface px-3 text-base"
            type="password"
            name="new_password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setPasswordStatus("idle");
            }}
          />
          <span className="font-normal text-muted">{t.newPasswordHint}</span>
        </label>
        <button
          type="submit"
          disabled={passwordStatus === "saving" || newPassword.length < 10}
          className="min-h-12 rounded-md border-2 border-fg px-5 font-bold disabled:opacity-50"
        >
          {passwordStatus === "saved"
            ? t.passwordSaved
            : me.has_password
              ? t.changePassword
              : t.addPassword}
        </button>
      </form>

      <button
        type="button"
        onClick={logOut}
        className="min-h-12 rounded-md bg-stamp px-5 font-bold text-paper"
      >
        {t.logOut}
      </button>

      <form
        onSubmit={deleteAccount}
        aria-labelledby="delete-title"
        className="flex flex-col gap-3 rounded-md border-2 border-dashed border-stamp p-4"
      >
        <h2 id="delete-title" className="text-xl">
          {t.deleteTitle}
        </h2>
        <p className="text-sm text-muted">{t.deleteBody}</p>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t.deleteConfirmLabel.replace("{username}", me.username)}
          <input
            className="min-h-12 rounded-md border-2 border-fg bg-surface px-3 text-base"
            name="confirm_username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={deleting || confirmName.trim().toLowerCase() !== me.username}
          className="min-h-12 rounded-md border-2 border-stamp px-5 font-bold text-accent-text disabled:opacity-50"
        >
          {deleting ? t.deleting : t.deleteButton}
        </button>
      </form>
    </div>
  );
}

/** Grey shapes where the profile will appear, instead of a blank or a "Log in" flash. */
function ProfileSkeleton({ label }: { label: string }) {
  const bar = "animate-pulse rounded bg-line/30";
  return (
    <div className="flex flex-col gap-6" role="status" aria-label={label}>
      <div className={`${bar} h-11 w-2/3`} />
      <div className="flex flex-col gap-3 rounded-md border-2 border-line/40 p-4">
        <div className={`${bar} h-4 w-24`} />
        <div className={`${bar} h-6 w-40`} />
        <div className={`${bar} h-4 w-20`} />
        <div className={`${bar} h-6 w-56 max-w-full`} />
      </div>
      <div className={`${bar} h-8 w-1/2`} />
      <div className={`${bar} h-28 w-full`} />
    </div>
  );
}
