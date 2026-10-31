import { Logo } from "@/components/brand";
import { BottomNav } from "@/components/BottomNav";
import { getMessages } from "@/i18n";

const t = getMessages();

/**
 * Shown the moment a link is tapped, while the next page is made on the server (every page is
 * made per visit). Next.js fetches this in advance, so a tap always answers at once, even on slow
 * data. It mirrors the pages' frame so nothing jumps when the real page arrives.
 */
export default function Loading() {
  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 py-4 pr-5 pl-9 md:px-12 md:py-6">
        <Logo />
        <span className="h-12 w-28 animate-pulse rounded-full bg-line/30" />
      </header>
      <main
        className="mx-auto w-full max-w-6xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24"
        aria-busy="true"
      >
        <span className="sr-only" role="status">
          {t.loading.label}
        </span>
        <div className="letter-sheet flex max-w-2xl animate-pulse flex-col gap-5 rounded-sm py-10 pr-6 pl-12 md:pl-16" aria-hidden="true">
          <div className="h-10 w-3/4 rounded bg-line/30" />
          <div className="h-5 w-full rounded bg-line/20" />
          <div className="h-5 w-5/6 rounded bg-line/20" />
          <div className="h-12 w-full rounded-md bg-line/20" />
          <div className="h-12 w-full rounded-md bg-line/20" />
          <div className="h-32 w-full rounded-md bg-line/20" />
        </div>
      </main>
      <BottomNav t={t.nav} />
    </>
  );
}
