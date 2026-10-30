"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { LetterPhoto } from "@/components/LetterCard";
import { hint, label } from "@/components/write-kit";
import { getMessages } from "@/i18n";
import { ApiError, api, peek, remember } from "@/lib/api";

const t = getMessages().photo;

type Status = { enabled: boolean; max_bytes: number };
type Uploaded = { id: string; url: string; small_url: string; width: number; height: number };
export type PhotoValue = {
  photoId: string;
  photoUrl: string; // signed links, refreshed when a saved draft comes back
  photoSmallUrl: string;
  photoWidth: number;
  photoHeight: number;
};
export const NO_PHOTO: PhotoValue = { photoId: "", photoUrl: "", photoSmallUrl: "", photoWidth: 0, photoHeight: 0 };

function asValue(photo: Uploaded): PhotoValue {
  return {
    photoId: photo.id,
    photoUrl: photo.url,
    photoSmallUrl: photo.small_url,
    photoWidth: photo.width,
    photoHeight: photo.height,
  };
}

/** The draft's photo for the letter preview, or none. */
export function draftPhoto(value: PhotoValue): LetterPhoto | null {
  if (!value.photoUrl) return null;
  return {
    url: value.photoUrl,
    smallUrl: value.photoSmallUrl || undefined,
    width: value.photoWidth || undefined,
    height: value.photoHeight || undefined,
  };
}

const MAX_SIDE = 2000;

/**
 * Phones take 3–12 MB photos; on slow data that's a long upload. Shrink to 2000 px as JPEG first
 * (the server cleans and checks it again either way). Falls back to the original file.
 */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** "Add a photo": uploads it right away (checked on the server) and keeps its id in the draft. */
export function PhotoField({
  value,
  onChange,
  loggedIn,
  next,
  labelText = t.label,
  hintText = t.hint,
}: {
  value: PhotoValue;
  onChange: (value: PhotoValue) => void;
  loggedIn: boolean;
  next: string;
  labelText?: string;
  hintText?: string;
}) {
  const [status, setStatus] = useState<Status | null>(() => peek<Status>("/photos/status") ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const refreshed = useRef(false);

  useEffect(() => {
    api<Status>("/photos/status")
      .then((found) => {
        remember("/photos/status", found);
        setStatus(found);
      })
      .catch(() => undefined);
  }, []);

  // A saved draft's photo link may have expired: ask for a fresh one once.
  useEffect(() => {
    if (!value.photoId || !loggedIn || refreshed.current) return;
    refreshed.current = true;
    api<Uploaded>(`/photos/${value.photoId}/link`)
      .then((fresh) => onChange(asValue(fresh)))
      .catch(() => onChange(NO_PHOTO));
  }, [value.photoId, loggedIn, onChange]);

  if (!status?.enabled) return null;

  if (!loggedIn) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-semibold">{labelText}</span>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="self-start font-bold underline">
          {t.logIn}
        </Link>
      </div>
    );
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const small = await shrink(file);
      if (small.size > (status?.max_bytes ?? Infinity)) throw new ApiError(413, t.failed);
      const done = await api<Uploaded>("/photos", { method: "POST", body: small });
      refreshed.current = true; // a brand-new link: nothing to refresh
      onChange(asValue(done));
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t.failed);
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className={label}>
        {labelText}
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <span className={hint}>{hintText}</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        {value.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a private, signed link
          <img src={value.photoSmallUrl || value.photoUrl} alt={t.previewAlt} width={80} height={80}
            decoding="async" className="h-20 w-20 rounded border-2 border-ink object-cover" />
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => picker.current?.click()}
          className="min-h-12 rounded-md border-2 border-fg px-4 text-sm font-bold disabled:opacity-60"
        >
          {busy ? t.checking : value.photoId ? t.change : t.choose}
        </button>
        {value.photoId && !busy && (
          <button type="button" onClick={() => onChange(NO_PHOTO)}
            className="min-h-12 px-2 text-sm font-bold text-accent-text underline">
            {t.remove}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-accent-text">
          {error}
        </p>
      )}
    </div>
  );
}
