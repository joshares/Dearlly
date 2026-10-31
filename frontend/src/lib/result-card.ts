/**
 * The end-of-game card, drawn on the phone (nothing is uploaded): a postage stamp with the game,
 * both names and the result, to save or share. The QR code opens dearlly.app, never the game.
 */

import {
  download,
  drawFrame,
  drawQr,
  drawSeal,
  fontFamily,
  FRAME,
  HEIGHT,
  INK,
  KRAFT,
  PAPER_BG,
  STAMP,
  toBlob,
  WIDTH,
  wrapText,
} from "@/lib/letter-image";

export type ResultCard = {
  game: string; // "Same page"
  level: string; // "Romantic"
  names: [string, string];
  headline: string; // "7 of 10 matched" / "Quality time & Physical touch"
  lines: string[]; // smaller lines under it
  date: string;
  kicker: string; // "GAME OVER"
  footer: string; // "Play together on"
  site: string; // "dearlly.app"
};

/** A perforated stamp: holes punched along every edge, like a real postage stamp. */
function drawStamp(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const hole = 11;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((-2 * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = "rgba(31, 42, 107, 0.16)";
  ctx.fillRect(12, 14, w, h);
  ctx.fillStyle = "#FFFDF8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#FBF6EE";
  for (let px = hole; px < w; px += hole * 3) {
    for (const py of [0, h]) {
      ctx.beginPath();
      ctx.arc(px, py, hole, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let py = hole; py < h; py += hole * 3) {
    for (const px of [0, w]) {
      ctx.beginPath();
      ctx.arc(px, py, hole, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = STAMP;
  ctx.lineWidth = 6;
  ctx.strokeRect(28, 28, w - 56, h - 56);
  ctx.restore();
}

export async function drawResultCard(card: ResultCard, origin: string): Promise<HTMLCanvasElement> {
  const heading = fontFamily("--font-gloock", "Georgia, serif");
  const body = fontFamily("--font-figtree", "system-ui, sans-serif");
  const hand = fontFamily("--font-homemade-apple", "cursive");
  await Promise.all([
    document.fonts.load(`96px ${heading}`),
    document.fonts.load(`700 40px ${body}`),
    document.fonts.load(`48px ${hand}`),
  ]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Saving isn't supported on this browser.");

  drawFrame(ctx, "#FBF6EE");
  drawSeal(ctx, WIDTH - FRAME - 110, FRAME + 100, 120, heading);
  const centre = WIDTH / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = STAMP;
  ctx.font = `800 30px ${body}`;
  ctx.fillText(card.kicker.toUpperCase().split("").join(" "), centre, FRAME + 150);

  ctx.fillStyle = INK;
  ctx.font = `400 84px ${heading}`;
  const title = wrapText(card.game, WIDTH - 320, (s) => ctx.measureText(s).width);
  let y = FRAME + 250;
  for (const line of title.slice(0, 2)) {
    ctx.fillText(line, centre, y);
    y += 92;
  }

  // Both names on one line between the margins: long names get smaller handwriting.
  const names = `${card.names[0]} & ${card.names[1]}`;
  let handSize = 46;
  for (; handSize > 26; handSize -= 2) {
    ctx.font = `${handSize}px ${hand}`;
    if (ctx.measureText(names).width <= WIDTH - 360) break;
  }
  ctx.fillText(names, centre, y + 30, WIDTH - 360);

  // The stamp with the result.
  const stampX = 150;
  const stampY = y + 90;
  const stampW = WIDTH - 300;
  const stampH = 470;
  drawStamp(ctx, stampX, stampY, stampW, stampH);
  ctx.fillStyle = INK;
  let size = 96;
  let headline: string[] = [];
  for (; size >= 48; size -= 6) {
    ctx.font = `400 ${size}px ${heading}`;
    headline = wrapText(card.headline, stampW - 140, (s) => ctx.measureText(s).width);
    if (headline.length <= 2) break;
  }
  ctx.font = `600 34px ${body}`;
  const details = card.lines
    .slice(0, 3)
    .flatMap((line) => wrapText(line, stampW - 140, (s) => ctx.measureText(s).width).slice(0, 2));
  // The result and its details, centred in the stamp whatever their length.
  const headlineHeight = headline.slice(0, 3).length * (size + 12);
  const block = headlineHeight + (details.length ? 30 + details.length * 46 : 0);
  let sy = stampY + (stampH - block) / 2 + size * 0.8;
  ctx.font = `400 ${size}px ${heading}`;
  for (const line of headline.slice(0, 3)) {
    ctx.fillText(line, centre, sy);
    sy += size + 12;
  }
  ctx.font = `600 34px ${body}`;
  sy += 30 - (size + 12) + 46;
  for (const part of details) {
    ctx.fillText(part, centre, sy);
    sy += 46;
  }

  ctx.fillStyle = "rgba(31, 42, 107, 0.75)";
  ctx.font = `600 30px ${body}`;
  ctx.fillText(`${card.level} · ${card.date}`, centre, stampY + stampH + 70);

  // Footer: QR to Dearlly (never to the game) and the invitation to play.
  const footerTop = HEIGHT - FRAME - 250;
  ctx.strokeStyle = KRAFT;
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(FRAME + 30, footerTop);
  ctx.lineTo(WIDTH - FRAME - 30, footerTop);
  ctx.stroke();
  ctx.setLineDash([]);
  drawQr(ctx, `${origin}/`, FRAME + 120, footerTop + 34, 180);
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `700 34px ${body}`;
  ctx.fillText(card.footer, FRAME + 340, footerTop + 110);
  ctx.fillStyle = STAMP;
  ctx.font = `400 60px ${heading}`;
  ctx.fillText(card.site, FRAME + 340, footerTop + 180);
  ctx.fillStyle = PAPER_BG; // leave the context tidy
  return canvas;
}

function cardFile(card: ResultCard): string {
  const slug = card.game.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `dearlly-${slug || "game"}-result.png`;
}

/** Shares the picture where the phone can (WhatsApp, Instagram…); otherwise saves it. */
export async function shareResultCard(card: ResultCard, text: string): Promise<"shared" | "saved"> {
  const blob = await toBlob(await drawResultCard(card, window.location.origin), "image/png");
  const file = new File([blob], cardFile(card), { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "shared"; // they closed it
    }
  }
  download(blob, file.name);
  return "saved";
}

export async function saveResultCard(card: ResultCard): Promise<void> {
  const blob = await toBlob(await drawResultCard(card, window.location.origin), "image/png");
  download(blob, cardFile(card));
}
