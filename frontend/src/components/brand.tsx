/**
 * Brand marks drawn in code until the illustrator's artwork arrives (design/illustrations/).
 * Colours are the brand tokens; fonts come from the CSS variables set in app/fonts.ts.
 */

export const SEAL_PATH =
  "M32 4c8-1 14 4 17 9 7 1 11 9 8 15 4 6 1 15-6 17-3 8-12 12-19 9-7 4-17 1-20-6-7-3-10-12-6-19-3-8 2-16 10-17 3-5 9-8 16-8z";

export function WaxSeal({ size = 44, label }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={SEAL_PATH} fill="#D7392B" stroke="#1F2A6B" strokeWidth="3" />
      <circle cx="32" cy="33" r="17" fill="none" stroke="#F3EADB" strokeWidth="1.2" strokeDasharray="2 2.5" />
      <text x="32" y="43" textAnchor="middle" fontSize="28" fill="#F3EADB" style={{ fontFamily: "var(--font-gloock), serif" }}>
        D
      </text>
    </svg>
  );
}

/** The logo: wax seal plus the Dearlly wordmark. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <WaxSeal size={size} />
      <span className="font-heading text-[1.75rem] leading-none md:text-[2rem]">Dearlly</span>
    </span>
  );
}

export function Postmark({
  text,
  center,
  size = 160,
  className = "",
}: {
  text: string;
  center?: string;
  size?: number;
  className?: string;
}) {
  const id = `pm-${text.replace(/\W/g, "").slice(0, 12)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <defs>
        <path id={id} d="M50 50 m-36 0 a36 36 0 1 1 72 0 a36 36 0 1 1 -72 0" />
      </defs>
      <g fill="none" stroke="currentColor">
        <circle cx="50" cy="50" r="46" strokeWidth="2" />
        <circle cx="50" cy="50" r="27" strokeWidth="1.2" />
      </g>
      <text fontWeight="800" fontSize="9" letterSpacing="2.4" fill="currentColor" style={{ fontFamily: "var(--font-figtree), sans-serif" }}>
        <textPath href={`#${id}`}>{text}</textPath>
      </text>
      {center && (
        <text x="50" y="55" textAnchor="middle" fontWeight="800" fontSize="13" fill="currentColor" style={{ fontFamily: "var(--font-figtree), sans-serif" }}>
          {center}
        </text>
      )}
    </svg>
  );
}

/** Hero illustration: a love letter peeking out of a sealed kraft envelope, postmark and stamp. */
export function HeroArt({
  label,
  letterTo,
  letterBody,
  postmarkClass = "text-fg",
}: {
  label: string;
  letterTo: string;
  letterBody: string;
  /** Text colour for the postmark, so it shows on both paper and ink backgrounds. */
  postmarkClass?: string;
}) {
  return (
    <svg viewBox="0 0 560 540" role="img" aria-label={label} className="h-auto w-full max-w-[560px]">
      {/* Letter */}
      <g transform="rotate(5 270 140)">
        <rect x="70" y="30" width="400" height="260" fill="#FBF6EE" stroke="#1F2A6B" strokeWidth="2.5" />
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1="80" x2="460" y1={78 + i * 34} y2={78 + i * 34} stroke="#C89B6D" strokeOpacity="0.55" />
        ))}
        <line x1="104" x2="104" y1="32" y2="288" stroke="#D7392B" strokeOpacity="0.5" strokeWidth="2" />
        <text x="118" y="70" fontSize="22" fill="#1F2A6B" style={{ fontFamily: "var(--font-homemade-apple), cursive" }}>
          {letterTo}
        </text>
        <text x="118" y="138" fontSize="16" fill="#1F2A6B" style={{ fontFamily: "var(--font-homemade-apple), cursive" }}>
          {letterBody}
        </text>
      </g>
      {/* Envelope */}
      <g transform="translate(10 190) rotate(-6 250 130) scale(2.05)">
        <rect x="6" y="6" width="228" height="128" rx="5" fill="#C89B6D" stroke="#1F2A6B" strokeWidth="1.4" />
        <path d="M8 130 L104 72 M232 130 L136 72" stroke="#1F2A6B" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M8 10 L120 86 L232 10" fill="#D4AC80" stroke="#1F2A6B" strokeWidth="1.4" strokeLinejoin="round" />
        <g transform="translate(97 60) scale(0.75)">
          <path d={SEAL_PATH} fill="#D7392B" stroke="#1F2A6B" strokeWidth="2" />
          <text x="32" y="43" textAnchor="middle" fontSize="28" fill="#F3EADB" style={{ fontFamily: "var(--font-gloock), serif" }}>
            D
          </text>
        </g>
      </g>
      {/* Postmark */}
      <g transform="translate(400 0)" className={postmarkClass} opacity="0.85">
        <Postmark text="LAGOS · 14 FEB 2027 · DEARLLY ·" size={150} />
      </g>
    </svg>
  );
}
