/** Dates are shown in Lagos time (UTC+1 all year), whatever the phone's own setting. */
export function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function lagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium" });
}

/** Whole days, hours, minutes and seconds until a moment (all zero once it has passed). */
export function timeLeft(iso: string, now: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}
