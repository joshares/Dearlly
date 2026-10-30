"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getMessages } from "@/i18n";

const t = getMessages().gift;

const KRAFT = "#C89B6D";
const INK = "#1F2A6B";
const BRUSH = 26; // finger-sized
const REVEAL_AT = 0.45; // share of the stamp scratched off before it all falls away

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The gift under a kraft scratch-off stamp. Scratch with a finger (or mouse); once about half is
 * off, the rest falls away. "Reveal it" does the same for keyboards, screen readers, reduced motion
 * and phones that can't draw.
 */
export function ScratchCard({
  gift,
  hint,
  startRevealed = false,
  onReveal,
}: {
  gift: string;
  hint?: string | null;
  startRevealed?: boolean;
  onReveal?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [revealed, setRevealed] = useState(startRevealed);
  // Scratching needs a canvas to draw on; reduced motion gets the plain "tap to open" stamp.
  const [canScratch] = useState(() => {
    if (typeof window === "undefined" || reducedMotion()) return false;
    try {
      return document.createElement("canvas").getContext("2d") !== null;
    } catch {
      return false;
    }
  });

  const reveal = useCallback(() => {
    setRevealed((was) => {
      if (!was) {
        navigator.vibrate?.([20, 40, 20]);
        onReveal?.();
      }
      return true;
    });
  }, [onReveal]);

  // Paint the stamp, sized to the card (and the screen's pixel density).
  useEffect(() => {
    const el = canvas.current;
    const holder = box.current;
    if (revealed || !canScratch || !el || !holder) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const paint = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = holder.getBoundingClientRect();
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = KRAFT;
      ctx.fillRect(0, 0, width, height);
      // Fine diagonal grain, like a postage stamp's foil.
      ctx.strokeStyle = "rgba(31, 42, 107, 0.12)";
      ctx.lineWidth = 1;
      for (let x = -height; x < width; x += 9) {
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x + height, 0);
        ctx.stroke();
      }
      ctx.strokeStyle = INK;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(10, 10, width - 20, height - 20);
      ctx.setLineDash([]);
      ctx.fillStyle = INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const font = getComputedStyle(document.body).fontFamily;
      ctx.font = `800 20px ${font}`;
      ctx.fillText(t.scratchHere, width / 2, height / 2 - (hint ? 14 : 0));
      if (hint) {
        ctx.font = `600 15px ${font}`;
        ctx.fillText(hint.length > 48 ? `${hint.slice(0, 47)}…` : hint, width / 2, height / 2 + 16);
      }
      strokes.current = 0;
    };
    paint();
    const watcher = new ResizeObserver(paint);
    watcher.observe(holder);
    return () => watcher.disconnect();
  }, [revealed, canScratch, hint]);

  function scratchedShare(ctx: CanvasRenderingContext2D, el: HTMLCanvasElement): number {
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let clear = 0;
    let seen = 0;
    for (let i = 3; i < data.length; i += 4 * 16) {
      seen += 1;
      if ((data[i] ?? 255) < 128) clear += 1;
    }
    return seen ? clear / seen : 0;
  }

  function scratch(event: React.PointerEvent<HTMLCanvasElement>) {
    if (revealed) return;
    const el = event.currentTarget;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const rect = el.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineWidth = BRUSH * 2;
    ctx.beginPath();
    ctx.moveTo((last.current ?? point).x, (last.current ?? point).y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
    strokes.current += 1;
    if (strokes.current % 8 === 0 && scratchedShare(ctx, el) >= REVEAL_AT) reveal();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={box}
        className="relative w-full max-w-sm overflow-hidden rounded-md border-2 border-ink bg-[#FBF6EE] shadow-[6px_6px_0_var(--shadow)]"
      >
        {/* The gift, under the stamp. Hidden from screen readers until revealed. */}
        <div className="flex min-h-40 flex-col items-center justify-center gap-1 px-6 py-8 text-center" aria-hidden={!revealed}>
          <span className="text-xs font-extrabold tracking-[0.14em] text-muted uppercase">{t.yourGift}</span>
          <span className={`text-2xl leading-tight font-heading ${revealed ? "gift-pop" : ""}`}>{gift}</span>
        </div>
        {!revealed && (
          <canvas
            ref={canvas}
            aria-hidden="true"
            className={`absolute inset-0 h-full w-full touch-none ${canScratch ? "cursor-grab" : "hidden"}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              last.current = null;
              scratch(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons || e.pointerType !== "mouse") scratch(e);
            }}
            onPointerUp={() => {
              last.current = null;
            }}
          />
        )}
        {!revealed && !canScratch && (
          // No drawing (or reduced motion): a plain stamp to tap open.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#C89B6D] text-center text-ink">
            <span className="text-xl font-extrabold">{t.giftInside}</span>
            {hint && <span className="px-6 text-sm font-semibold">{hint}</span>}
          </div>
        )}
      </div>
      {revealed ? (
        <p className="font-hand text-lg" aria-live="polite">
          {t.revealed}
        </p>
      ) : (
        <button type="button" onClick={reveal} className="min-h-12 rounded-lg border-2 border-fg px-5 text-sm font-bold">
          {canScratch ? t.revealInstead : t.reveal}
        </button>
      )}
    </div>
  );
}
