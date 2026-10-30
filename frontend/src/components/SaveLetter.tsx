"use client";

import { useState } from "react";

import type { LetterContent } from "@/components/LetterCard";
import { getMessages } from "@/i18n";

const t = getMessages().save;

/** "Save as picture" / "Save as PDF". The drawing code loads only when tapped. */
export function SaveLetter({ letter }: { letter: LetterContent }) {
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(format: "png" | "pdf") {
    setBusy(format);
    setError(null);
    try {
      const { saveLetter } = await import("@/lib/letter-image");
      await saveLetter(letter, format, { qrLine: t.qrLine, site: t.site });
    } catch {
      setError(t.failed);
    } finally {
      setBusy(null);
    }
  }

  const button =
    "min-h-12 rounded-lg border-2 border-fg bg-surface px-4 font-bold disabled:opacity-60";
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">{t.heading}</span>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} disabled={busy !== null} onClick={() => save("png")}>
          {busy === "png" ? t.saving : t.png}
        </button>
        <button type="button" className={button} disabled={busy !== null} onClick={() => save("pdf")}>
          {busy === "pdf" ? t.saving : t.pdf}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-accent-text">
          {error}
        </p>
      )}
    </div>
  );
}
