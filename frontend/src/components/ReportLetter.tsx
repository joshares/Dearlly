"use client";

import { useState } from "react";

import { getMessages } from "@/i18n";
import { ApiError, api } from "@/lib/api";

const t = getMessages().letter;
type Reason = keyof typeof t.reportReasons;
const REASONS = Object.keys(t.reportReasons) as Reason[];

/** "Report this letter": on every letter, and opened straight away from the email's link. */
export function ReportLetter({ token, startOpen = false }: { token: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) {
      setError(t.reportPick);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/letters/${encodeURIComponent(token)}/report`, {
        method: "POST",
        body: { reason, note: note.trim() || null },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="rounded-md border-2 border-dashed border-line bg-surface p-3 text-sm">
        {t.reportThanks}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-12 self-center text-sm font-semibold text-muted underline"
      >
        {t.report}
      </button>
    );
  }

  return (
    <form
      onSubmit={send}
      aria-labelledby="report-title"
      className="flex w-full flex-col gap-3 rounded-md border-2 border-dashed border-stamp p-4"
    >
      <h2 id="report-title" className="text-2xl">
        {t.reportHeading}
      </h2>
      <p className="text-sm text-muted">{t.reportLead}</p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="report-title">
        {REASONS.map((key) => (
          <label
            key={key}
            className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-md border-2 bg-surface px-3 font-semibold ${
              reason === key ? "border-stamp" : "border-line"
            }`}
          >
            <input
              type="radio"
              name="reason"
              value={key}
              checked={reason === key}
              onChange={() => setReason(key)}
              className="h-5 w-5 accent-[var(--color-stamp)]"
            />
            {t.reportReasons[key]}
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        {t.reportNote}
        <textarea
          name="report_note"
          maxLength={280}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-20 w-full rounded-md border-2 border-fg bg-surface px-3 py-2 text-base"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm font-semibold text-accent-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 rounded-md bg-stamp px-5 font-bold text-paper disabled:opacity-60"
        >
          {busy ? t.reportSending : t.reportSend}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-12 rounded-md border-2 border-fg px-5 font-bold"
        >
          {t.reportCancel}
        </button>
      </div>
    </form>
  );
}
