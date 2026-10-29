"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getMessages } from "@/i18n";
import { ApiError, api, type MyProfile } from "@/lib/api";

const t = getMessages().profile;

export function ProfileView() {
  const router = useRouter();
  const [me, setMe] = useState<MyProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api<MyProfile>("/me")
      .then((profile) => {
        setMe(profile);
        setDisplayName(profile.display_name ?? "");
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
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
      setMe(updated);
      setStatus("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
      setStatus("idle");
    }
  }

  async function deleteAccount(event: React.FormEvent) {
    event.preventDefault();
    setDeleting(true);
    setError(null);
    try {
      await api("/me/delete", { method: "POST", body: { confirm_username: confirmName } });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong.");
      setDeleting(false);
    }
  }

  async function logOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  if (!me) {
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <p className="font-hand text-lg text-muted">{t.loading}</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl">{t.title}</h1>
      <dl className="flex flex-col gap-3 rounded-md border-2 border-line bg-surface p-4">
        <div>
          <dt className="text-sm text-muted">{t.usernameLabel}</dt>
          <dd className="text-lg font-bold">@{me.username}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t.emailLabel}</dt>
          <dd>
            {me.email} <span className="block text-sm text-muted">{t.emailPrivate}</span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">{t.planLabel}</dt>
          <dd>{t.planFree}</dd>
        </div>
      </dl>

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
