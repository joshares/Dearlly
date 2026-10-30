import { WaxSeal } from "@/components/brand";
import { getMessages } from "@/i18n";

const letterPhotoAlt = getMessages().photo.alt;

export type LetterTheme = "cream" | "kraft" | "rose";

// Paper colours for each theme. Ink text on all of them; always light paper (no dark mode).
export const PAPER: Record<LetterTheme, string> = {
  cream: "#FBF6EE",
  kraft: "#E8D2B4",
  rose: "#F7E1DA",
};

/** Signed links to a photo: full size (saving, big screens) and a lighter one for phones. The size
 *  lets the page keep the photo's space before it loads, so nothing jumps. */
export type LetterPhoto = { url: string; smallUrl?: string; width?: number; height?: number };

/** Props for an <img> of a letter photo: the phone copy on phones, the full one on big screens. */
export function photoImgProps(photo: LetterPhoto, display: string) {
  return {
    src: photo.smallUrl ?? photo.url,
    srcSet: photo.smallUrl ? `${photo.smallUrl} 960w, ${photo.url} 1600w` : undefined,
    sizes: display,
    width: photo.width,
    height: photo.height,
    decoding: "async" as const,
  };
}

export type LetterContent = {
  senderName: string;
  recipientName: string;
  recipientTitle?: string | null;
  quoteTitle?: string | null;
  quoteText: string;
  theme: LetterTheme;
  // The letter's photo, shown as a taped polaroid.
  photo?: LetterPhoto | null;
  // Gift reveals: the photo hidden under the scratch-off stamp instead.
  giftPhoto?: LetterPhoto | null;
  // Date invitations: "Where", "When", "Note" under the message.
  details?: { label: string; value: string }[];
};

/** A letter on ruled paper (love note or invitation). Used for the live preview and the recipient. */
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
      {letter.photo && (
        <figure className="mx-auto my-4 w-fit max-w-full -rotate-2 bg-white p-2 pb-6 shadow-[3px_4px_0_var(--shadow)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed link */}
          <img
            {...photoImgProps(letter.photo, "(max-width: 640px) 80vw, 480px")}
            alt={letterPhotoAlt.replace("{sender}", letter.senderName || "…")}
            className="block h-auto max-h-80 w-auto max-w-full object-contain"
          />
        </figure>
      )}
      {letter.quoteTitle?.trim() && (
        <h2 className="mt-2 text-3xl leading-tight md:text-4xl">{letter.quoteTitle}</h2>
      )}
      <p className="mt-3 text-lg leading-[2.25rem] whitespace-pre-line">
        {letter.quoteText.trim() || <span className="text-muted">{placeholder}</span>}
      </p>
      {letter.details && letter.details.length > 0 && (
        <dl className="mt-5 flex flex-col gap-2 rounded-md border-2 border-dashed border-ink/40 bg-white/40 p-4">
          {letter.details.map((d) => (
            <div key={d.label} className="flex flex-col">
              <dt className="text-xs font-extrabold tracking-[0.12em] text-muted uppercase">{d.label}</dt>
              <dd className="text-lg font-semibold whitespace-pre-line">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="font-hand mt-6 text-right text-xl leading-[2.2]">
        — {letter.senderName.trim() || "…"}
      </p>
    </article>
  );
}
