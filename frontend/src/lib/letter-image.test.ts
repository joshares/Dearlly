import { describe, expect, it } from "vitest";

import { fileName, jpegToPdf, wrapText } from "./letter-image";

// One unit per character keeps the maths easy to follow.
const measure = (s: string) => Array.from(s).length;

describe("wrapText", () => {
  it("wraps on spaces and keeps the writer's line breaks", () => {
    expect(wrapText("na you my heart choose", 10, measure)).toEqual(["na you my", "heart", "choose"]);
    expect(wrapText("Hi\n\nyou", 10, measure)).toEqual(["Hi", "", "you"]);
  });

  it("breaks a word longer than the line", () => {
    expect(wrapText("aaaaaaaaaaaa b", 5, measure)).toEqual(["aaaaa", "aaaaa", "aa b"]);
  });
});

describe("fileName", () => {
  it("is safe for every phone", () => {
    expect(fileName("My Love ❤️", "png")).toBe("dearlly-letter-to-my-love.png");
    expect(fileName("Adébáyọ̀", "pdf")).toBe("dearlly-letter-to-adebayo.pdf");
    expect(fileName("❤️", "png")).toBe("dearlly-letter.png");
    expect(fileName("../../etc/passwd", "pdf")).toBe("dearlly-letter-to-etc-passwd.pdf");
  });
});

describe("jpegToPdf", () => {
  it("writes a valid one-page PDF whose index points at each object", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const bytes = new Uint8Array(await jpegToPdf(jpeg, 1080, 1350).arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 540 675]");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

    const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
});
