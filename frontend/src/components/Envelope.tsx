/** Placeholder envelope until the illustrator's artwork arrives (design/illustrations/). */
export function Envelope({ label }: { label: string }) {
  return (
    <svg
      viewBox="0 0 240 160"
      role="img"
      aria-label={label}
      className="drift h-auto w-56 drop-shadow-[4px_6px_0_rgba(31,42,107,0.18)]"
    >
      <rect x="6" y="6" width="228" height="148" rx="6" fill="#C89B6D" stroke="#1F2A6B" strokeWidth="3" />
      <path d="M8 150 L104 82 M232 150 L136 82" stroke="#1F2A6B" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M8 10 L120 96 L232 10" fill="#D4AC80" stroke="#1F2A6B" strokeWidth="3" strokeLinejoin="round" />
      {/* Wax seal */}
      <path
        d="M120 72c9-2 17 3 21 10 6 1 9 9 6 15 3 7-2 15-9 16-4 7-13 9-19 5-7 3-15-1-17-8-7-3-9-12-4-18-2-8 4-15 12-15 2-3 6-5 10-5z"
        fill="#D7392B"
        stroke="#1F2A6B"
        strokeWidth="2.5"
      />
      <text x="121" y="106" textAnchor="middle" fontFamily="var(--font-gloock), serif" fontSize="26" fill="#F3EADB">
        D
      </text>
      {/* Postage stamp */}
      <rect x="186" y="20" width="32" height="38" fill="#F3EADB" stroke="#1F2A6B" strokeWidth="2" strokeDasharray="3 2" />
      <circle cx="202" cy="39" r="9" fill="none" stroke="#D7392B" strokeWidth="2" />
    </svg>
  );
}
