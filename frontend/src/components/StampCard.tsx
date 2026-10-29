const TONES = {
  kraft: "bg-kraft text-ink",
  stamp: "bg-stamp text-paper",
  ink: "bg-ink text-paper",
  paper: "bg-paper text-ink",
} as const;

/** A tilted postage stamp with perforated edges. */
export function StampCard({
  title,
  body,
  tone,
  tilt,
}: {
  title: string;
  body: string;
  tone: keyof typeof TONES;
  tilt: string;
}) {
  return (
    // The shadow sits on a wrapper: on the masked element it would be cut off with the holes.
    <div className={`drop-shadow-[4px_6px_0_var(--shadow)] ${tilt}`}>
      <div className="stamp-edge bg-[#FBF6EE]">
        <div
          className={`flex aspect-[4/5] flex-col justify-end gap-1 border-2 border-ink p-3 sm:p-4 md:p-5 ${TONES[tone]}`}
        >
          <h3 className="text-lg leading-tight sm:text-xl md:text-2xl">{title}</h3>
          <p className="text-sm leading-snug font-semibold">{body}</p>
        </div>
      </div>
    </div>
  );
}
