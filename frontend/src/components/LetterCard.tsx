import { WaxSeal } from "@/components/brand";

export type LetterTheme = "cream" | "kraft" | "rose";

// Paper colours for each theme. Ink text on all of them; always light paper (no dark mode).
export const PAPER: Record<LetterTheme, string> = {
  cream: "#FBF6EE",
  kraft: "#E8D2B4",
  rose: "#F7E1DA",
};

export type LetterContent = {
  senderName: string;
  recipientName: string;
  recipientTitle?: string | null;
  quoteTitle?: string | null;
  quoteText: string;
  theme: LetterTheme;
};

/** A love note on ruled letter paper. Used for the live preview and the recipient's letter. */
export function LetterCard({ letter, placeholder }: { letter: LetterContent; placeholder: string }) {
  const greeting = letter.recipientTitle?.trim() || letter.recipientName.trim();
  return (
    <article
      className="relative overflow-hidden rounded-sm px-6 py-8 pl-12 text-ink shadow-[8px_10px_0_var(--shadow)] md:px-10 md:py-10 md:pl-16"
      style={{
        backgroundColor: PAPER[letter.theme],
        backgroundImage:
          "linear-gradient(90deg, transparent 27px, rgb(215 57 43 / 0.5) 27px 29px, transparent 29px), repeating-linear-gradient(transparent 0 35px, rgb(31 42 107 / 0.12) 35px 36px)",
      }}
    >
      <div className="absolute top-4 right-4 rotate-6">
        <WaxSeal size={52} />
      </div>
      <p className="font-hand text-xl leading-[2.2]">Dear {greeting || "…"},</p>
      {letter.quoteTitle?.trim() && (
        <h2 className="mt-2 text-3xl leading-tight md:text-4xl">{letter.quoteTitle}</h2>
      )}
      <p className="mt-3 text-lg leading-[2.25rem] whitespace-pre-line">
        {letter.quoteText.trim() || <span className="text-muted">{placeholder}</span>}
      </p>
      <p className="font-hand mt-6 text-right text-xl leading-[2.2]">
        — {letter.senderName.trim() || "…"}
      </p>
    </article>
  );
}
