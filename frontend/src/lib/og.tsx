import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * The picture shown when a Dearlly link is shared (WhatsApp, Instagram, X, iMessage):
 * an airmail-edged sheet with a sealed envelope. Made on our server; it never shows a letter's
 * words, names or photo, so a preview in a group chat gives nothing away.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

const PAPER = "#F3EADB";
const INK = "#1F2A6B";
const STAMP = "#D7392B";
const KRAFT = "#C89B6D";

// WOFF copies of the site's fonts (the picture maker can't read WOFF2). Read once per server.
// They're shipped with the server by outputFileTracingIncludes in next.config.ts.
const FONT_DIR = join(process.cwd(), "src/fonts/og");
let fonts: Promise<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]> | null = null;

function loadFonts() {
  fonts ??= Promise.all([
    readFile(join(FONT_DIR, "gloock-latin-400-normal.woff")),
    readFile(join(FONT_DIR, "figtree-latin-600-normal.woff")),
    readFile(join(FONT_DIR, "figtree-latin-800-normal.woff")),
    readFile(join(FONT_DIR, "homemade-apple-latin-400-normal.woff")),
  ]).then(([gloock, figtree600, figtree800, hand]) => [
    { name: "Gloock", data: gloock, weight: 400 as const, style: "normal" as const },
    { name: "Figtree", data: figtree600, weight: 600 as const, style: "normal" as const },
    { name: "Figtree", data: figtree800, weight: 800 as const, style: "normal" as const },
    { name: "Homemade Apple", data: hand, weight: 400 as const, style: "normal" as const },
  ]);
  return fonts;
}

export type OgCard = { kicker: string; title: string; line: string; site: string };

function Envelope() {
  return (
    <div style={{ display: "flex", position: "relative", width: 380, height: 270, transform: "rotate(-4deg)" }}>
      <svg width="380" height="270" viewBox="0 0 380 270" style={{ position: "absolute", top: 0, left: 0 }}>
        <rect x="10" y="14" width="370" height="256" fill={INK} opacity="0.16" />
        <rect x="0" y="0" width="370" height="256" fill={KRAFT} />
        <path d="M0 256 L185 120 L370 256" fill="none" stroke="#A97B4F" strokeWidth="4" />
        <path d="M0 0 L185 150 L370 0 Z" fill="#D9B48C" stroke="#A97B4F" strokeWidth="4" />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 135,
          top: 100,
          width: 100,
          height: 100,
          borderRadius: 50,
          background: STAMP,
          border: "6px solid #B32A1E",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: PAPER,
          fontFamily: "Gloock",
          fontSize: 58,
        }}
      >
        D
      </div>
    </div>
  );
}

export async function ogImage(card: OgCard): Promise<ImageResponse> {
  const titleSize = card.title.length > 28 ? 72 : 88;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 20,
          // The airmail edge, as on the site.
          backgroundImage: `repeating-linear-gradient(45deg, ${STAMP} 0px, ${STAMP} 26px, ${PAPER} 26px, ${PAPER} 52px, ${INK} 52px, ${INK} 78px, ${PAPER} 78px, ${PAPER} 104px)`,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: PAPER,
            padding: "56px 64px",
            gap: 40,
            color: INK,
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 22 }}>
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                border: `4px solid ${STAMP}`,
                borderRadius: 6,
                padding: "6px 16px",
                color: STAMP,
                fontFamily: "Figtree",
                fontWeight: 800,
                fontSize: 24,
                letterSpacing: 4,
                textTransform: "uppercase",
                transform: "rotate(-2deg)",
              }}
            >
              {card.kicker}
            </div>
            <div style={{ display: "block", fontFamily: "Gloock", fontSize: titleSize, lineHeight: 1.05, textWrap: "balance" }}>
              {card.title}
            </div>
            <div style={{ display: "flex", fontFamily: "Figtree", fontWeight: 600, fontSize: 32, lineHeight: 1.35, opacity: 0.8 }}>
              {card.line}
            </div>
            <div style={{ display: "flex", marginTop: 18, fontFamily: "Homemade Apple", fontSize: 34, color: STAMP }}>
              {card.site}
            </div>
          </div>
          <Envelope />
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts() },
  );
}
