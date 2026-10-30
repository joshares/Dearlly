/**
 * Saves a letter as a picture (PNG) or PDF, drawn on the phone itself: nothing is uploaded.
 * Loaded only when someone taps Save, so it adds nothing to the page's first download.
 *
 * The QR code opens dearlly.app, never the private letter link: saved letters get posted on
 * statuses and stories, and a stranger scanning the code must not be able to open or reply.
 */

import qrcode from "qrcode-generator";

import { SEAL_PATH } from "@/components/brand";
import { type LetterContent, PAPER } from "@/components/LetterCard";

export const WIDTH = 1080;
export const HEIGHT = 1350;

const INK = "#1F2A6B";
const STAMP = "#D7392B";
const KRAFT = "#C89B6D";
const PAPER_BG = "#F3EADB";

const FRAME = 28; // airmail stripe border
const MARGIN_X = FRAME + 104; // red margin line
const TEXT_X = MARGIN_X + 44;
const TEXT_RIGHT = WIDTH - FRAME - 72;
const RULE = 56;
const FOOTER_TOP = HEIGHT - FRAME - 250;

export type SaveText = { qrLine: string; site: string };

type Measure = (text: string) => number;

/** Splits text into lines that fit `width`, keeping the writer's own line breaks. */
export function wrapText(text: string, width: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine) <= width) {
        line = tryLine;
        continue;
      }
      if (line) lines.push(line);
      // A single word wider than the line (a long name, a run of emoji): break it up.
      line = "";
      for (const char of Array.from(word)) {
        if (line && measure(line + char) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A safe file name: "dearlly-letter-to-tolu.png". */
export function fileName(recipient: string, ext: "png" | "pdf"): string {
  const slug = recipient
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents and tone marks: "Adébáyọ̀" -> "Adebayo"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `dearlly-letter${slug ? `-to-${slug}` : ""}.${ext}`;
}

function fontFamily(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
}

function drawFrame(ctx: CanvasRenderingContext2D, paper: string) {
  ctx.fillStyle = PAPER_BG;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // Diagonal airmail stripes, then the letter paper laid on top.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WIDTH, HEIGHT);
  ctx.rect(FRAME, FRAME, WIDTH - FRAME * 2, HEIGHT - FRAME * 2);
  ctx.clip("evenodd");
  const stripes: [string, number][] = [
    [STAMP, 26],
    [PAPER_BG, 14],
    [INK, 26],
    [PAPER_BG, 14],
  ];
  for (let x = -HEIGHT, i = 0; x < WIDTH + HEIGHT; i++) {
    const [color, w] = stripes[i % stripes.length] ?? [INK, 26];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w + HEIGHT, HEIGHT);
    ctx.lineTo(x + HEIGHT, HEIGHT);
    ctx.fill();
    x += w;
  }
  ctx.restore();

  ctx.fillStyle = paper;
  ctx.fillRect(FRAME, FRAME, WIDTH - FRAME * 2, HEIGHT - FRAME * 2);
  ctx.strokeStyle = "rgb(31 42 107 / 0.12)";
  ctx.lineWidth = 2;
  for (let y = FRAME + RULE * 2; y < FOOTER_TOP - 10; y += RULE) {
    ctx.beginPath();
    ctx.moveTo(FRAME, y);
    ctx.lineTo(WIDTH - FRAME, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgb(215 57 43 / 0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, FRAME);
  ctx.lineTo(MARGIN_X, HEIGHT - FRAME);
  ctx.stroke();
}

function drawSeal(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, heading: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((6 * Math.PI) / 180);
  ctx.scale(size / 64, size / 64);
  ctx.translate(-32, -32);
  const seal = new Path2D(SEAL_PATH);
  ctx.fillStyle = STAMP;
  ctx.fill(seal);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke(seal);
  ctx.fillStyle = PAPER_BG;
  ctx.font = `400 28px ${heading}`;
  ctx.textAlign = "center";
  ctx.fillText("D", 32, 43);
  ctx.restore();
}

function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const quiet = 2;
  const cell = size / (count + quiet * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = INK;
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(
          x + (col + quiet) * cell,
          y + (row + quiet) * cell,
          Math.ceil(cell),
          Math.ceil(cell),
        );
      }
    }
  }
}

/** Draws the letter on a canvas: the same paper, words and seal as on screen. */
export async function drawLetter(letter: LetterContent, text: SaveText): Promise<HTMLCanvasElement> {
  const heading = fontFamily("--font-gloock", "Georgia, serif");
  const body = fontFamily("--font-figtree", "system-ui, sans-serif");
  const hand = fontFamily("--font-homemade-apple", "cursive");
  await Promise.all([
    document.fonts.load(`72px ${heading}`),
    document.fonts.load(`40px ${body}`),
    document.fonts.load(`700 40px ${body}`),
    document.fonts.load(`44px ${hand}`),
  ]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Saving isn't supported on this browser.");

  drawFrame(ctx, PAPER[letter.theme]);
  drawSeal(ctx, WIDTH - FRAME - 110, FRAME + 100, 120, heading);

  const width = TEXT_RIGHT - TEXT_X;
  const greeting = letter.recipientTitle?.trim() || letter.recipientName.trim();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.font = `44px ${hand}`;
  let y = FRAME + RULE * 2 - 14;
  for (const line of wrapText(`Dear ${greeting},`, width - 130, (s) => ctx.measureText(s).width)) {
    ctx.fillText(line, TEXT_X, y);
    y += RULE;
  }

  const title = letter.quoteTitle?.trim();
  if (title) {
    ctx.font = `400 68px ${heading}`;
    y += 44; // clear of the handwriting's tails
    for (const line of wrapText(title, width, (s) => ctx.measureText(s).width)) {
      ctx.fillText(line, TEXT_X, y);
      y += 78;
    }
    y -= 14;
  }

  // Short letters are written big; long ones shrink until they fit above the footer.
  const signOffSpace = 120;
  let size = 60;
  const details = (letter.details ?? []).map((d) => `${d.label}: ${d.value.replace(/\n/g, ", ")}`);
  const message = [letter.quoteText.trim().replace(/\n{3,}/g, "\n\n"), details.join("\n")]
    .filter(Boolean)
    .join("\n\n");
  let lines: string[] = [];
  let lineHeight = RULE;
  for (; size >= 24; size -= 2) {
    ctx.font = `400 ${size}px ${body}`;
    lineHeight = Math.max(Math.round(size * 1.45), 34);
    lines = wrapText(message, width, (s) => ctx.measureText(s).width);
    if (y + 14 + lines.length * lineHeight <= FOOTER_TOP - signOffSpace) break;
  }
  y += 14 + lineHeight * 0.6;
  // Last resort (e.g. hundreds of blank lines): cut off rather than run into the footer.
  const room = Math.max(1, Math.floor((FOOTER_TOP - signOffSpace - y) / lineHeight) + 1);
  if (lines.length > room) lines = [...lines.slice(0, room - 1), `${lines[room - 1] ?? ""}…`];
  for (const line of lines) {
    ctx.fillText(line, TEXT_X, y);
    y += lineHeight;
  }

  ctx.font = `44px ${hand}`;
  ctx.textAlign = "right";
  const signOff =
    wrapText(`— ${letter.senderName.trim()}`, width, (s) => ctx.measureText(s).width)[0] ?? "";
  ctx.fillText(signOff, TEXT_RIGHT, Math.min(y + 40, FOOTER_TOP - 40));

  // Footer: postmark-style divider, QR code to Dearlly, and the call to make one.
  ctx.textAlign = "left";
  ctx.strokeStyle = KRAFT;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(FRAME + 30, FOOTER_TOP);
  ctx.lineTo(WIDTH - FRAME - 30, FOOTER_TOP);
  ctx.stroke();
  ctx.setLineDash([]);

  const qrSize = 180;
  const qrY = FOOTER_TOP + 34;
  drawQr(ctx, `${window.location.origin}/`, TEXT_X, qrY, qrSize);
  const textX = TEXT_X + qrSize + 40;
  ctx.fillStyle = INK;
  ctx.font = `700 34px ${body}`;
  ctx.fillText(text.qrLine, textX, qrY + 70);
  ctx.fillStyle = STAMP;
  ctx.font = `400 52px ${heading}`;
  ctx.fillText(text.site, textX, qrY + 140);

  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't save the picture."))),
      type,
      quality,
    );
  });
}

/** A one-page PDF holding a JPEG, sized to the picture (no PDF library needed). */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Blob {
  const pageW = (width * 72) / 144; // 144 dpi: 1080 × 1350 px prints at 7.5 × 9.4 inches
  const pageH = (height * 72) / 144;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      "/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
  );
  const draw = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  object(4, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  offsets[5] = length;
  push(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");

  const xref = length;
  const rows = offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`);
  push(`xref\n0 6\n0000000000 65535 f \n${rows.join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function saveLetter(letter: LetterContent, format: "png" | "pdf", text: SaveText) {
  const canvas = await drawLetter(letter, text);
  const name = fileName(letter.recipientTitle?.trim() || letter.recipientName, format);
  if (format === "png") {
    download(await toBlob(canvas, "image/png"), name);
    return;
  }
  const jpeg = new Uint8Array(await (await toBlob(canvas, "image/jpeg", 0.92)).arrayBuffer());
  download(jpegToPdf(jpeg, WIDTH, HEIGHT), name);
}
