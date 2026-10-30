"use client";

import { useEffect, useState } from "react";

import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";

const t = getMessages().unsubscribe;

type Scope = "sender" | "all";

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

/** "Stop letters from @ada" or "Never email me again", from the links in a letter email. */
export function StopEmails({ token, preferAll }: { token: string; preferAll: boolean }) {
  const [sender, setSender] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Scope | null>(null);
  const [done, setDone] = useState<Scope | null>(null);
  const path = `/email/unsubscribe/${encodeURIComponent(token)}`;

  useEffect(() => {
    api<{ sender: string }>(path)
      .then((info) => setSender(info.sender))
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again."),
      );
  }, [path]);

  async function stop(scope: Scope) {
    setBusy(scope);
    setError(null);
    try {
      await api(path, { method: "POST", body: { scope } });
      setDone(scope);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const option = (scope: Scope, label: string, hint: string, strong: boolean) => (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => stop(scope)}
        className={`min-h-14 rounded-lg px-5 text-left font-extrabold disabled:opacity-60 ${
          strong
            ? "bg-stamp text-paper shadow-[3px_3px_0_var(--color-ink)]"
            : "border-2 border-fg bg-surface"
        }`}
      >
        {busy === scope ? t.saving : label}
      </button>
      <span className="text-sm text-muted">{hint}</span>
    </div>
  );

  return (
    <section className="flex flex-col gap-5" aria-live="polite">
      <h1 className="text-4xl leading-tight">{t.title}</h1>
      {error && (
        <p role="alert" className="rounded-md border-2 border-stamp p-3 text-sm font-semibold">
          {error}
        </p>
      )}
      {done && sender && (
        <p className="text-lg font-semibold">
          {done === "all" ? t.doneAll : fill(t.doneSender, { sender })}
        </p>
      )}
      {!done && !error && !sender && <p className="font-hand text-lg text-muted">{t.loading}</p>}
      {!done && sender && (
        <>
          <p className="text-muted">{t.lead}</p>
          {option("sender", fill(t.stopSender, { sender }), t.stopSenderHint, !preferAll)}
          {option("all", t.never, t.neverHint, preferAll)}
        </>
      )}
    </section>
  );
}
