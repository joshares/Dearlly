import Link from "next/link";

const TONES = {
  kraft: "bg-kraft text-ink",
  stamp: "bg-stamp text-paper",
  ink: "bg-ink text-paper",
  paper: "bg-paper text-ink",
} as const;

/** A tilted postage stamp with perforated edges. With href it opens that letter's form. */
export function StampCard({
  title,
  body,
  tone,
  tilt,
  href,
  action,
  soon,
}: {
  title: string;
  body: string;
  tone: keyof typeof TONES;
  tilt: string;
  href?: string;
  action?: string;
  soon?: string;
}) {
  const stamp = (
    // The shadow sits on a wrapper: on the masked element it would be cut off with the holes.
    <div className={`drop-shadow-[4px_6px_0_var(--shadow)] ${tilt}`}>
      <div className="stamp-edge bg-[#FBF6EE]">
        <div
          className={`flex aspect-[4/5] flex-col justify-end gap-1 border-2 border-ink p-3 sm:p-4 md:p-5 ${TONES[tone]}`}
        >
          {soon && !href && (
            <span className="mb-auto self-start rounded-full border-2 border-current px-2 py-0.5 text-[0.65rem] font-extrabold tracking-[0.1em] uppercase opacity-80">
              {soon}
            </span>
          )}
          <h3 className="text-lg leading-tight sm:text-xl md:text-2xl">{title}</h3>
          <p className="text-sm leading-snug font-semibold">{body}</p>
          {href && action && (
            <span className="mt-1 text-sm font-extrabold underline underline-offset-4">{action} →</span>
          )}
        </div>
      </div>
    </div>
  );
  if (!href) return stamp;
  return (
    <Link
      href={href}
      className="block rounded-md no-underline transition-transform hover:-translate-y-1 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-stamp"
    >
      {stamp}
    </Link>
  );
}
