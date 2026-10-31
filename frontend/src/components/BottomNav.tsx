import Link from "next/link";

import type { Messages } from "@/i18n";

type NavKey = "home" | "create" | "games" | "stamps" | "profile";

const ICONS: Record<NavKey, React.ReactNode> = {
  home: <path d="M4 11 12 4l8 7v9H4z M10 20v-5h4v5" />,
  create: <path d="M3 6h18v12H3z M3 6l9 7 9-7" />,
  games: <path d="M5 6h9v13H5z M10 3h9v13" />,
  stamps: <path d="M6 4h12v16H6z M9 8h6v6H9z" />,
  profile: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1-4 4-6 8-6s7 2 8 6" />,
};

// Games and Stamps arrive in later stages.
const ITEMS: { key: NavKey; href?: string }[] = [
  { key: "home", href: "/" },
  { key: "create", href: "/write" },
  { key: "games" },
  { key: "stamps" },
  { key: "profile", href: "/profile" },
];

export function BottomNav({ t, current }: { t: Messages["nav"]; current?: NavKey }) {
  return (
    <nav
      aria-label={t.label}
      className="fixed inset-x-[var(--frame)] bottom-[var(--frame)] z-40 border-t-2 border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {ITEMS.map(({ key, href }) => {
          const icon = (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
              {ICONS[key]}
            </svg>
          );
          const base = "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold";
          return (
            <li key={key}>
              {href ? (
                <Link
                  href={href}
                  aria-current={current === key ? "page" : undefined}
                  className={`${base} ${current === key ? "border-t-4 border-stamp text-accent-text" : "text-fg"}`}
                >
                  {icon}
                  {t[key]}
                </Link>
              ) : (
                <span aria-disabled="true" className={`${base} text-muted opacity-60`}>
                  {icon}
                  <span>
                    {t[key]}
                    <span className="sr-only"> ({t.soon})</span>
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
