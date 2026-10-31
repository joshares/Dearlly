"use client";

import dynamic from "next/dynamic";

// The drafts are read from this device's storage, so the forms render in the browser only
// (no server render that could disagree with the saved draft). Until their code arrives, a
// skeleton of the form holds the space, so the page answers at once even on slow data.
function FormSkeleton() {
  return (
    <div className="grid animate-pulse gap-10 md:grid-cols-2 md:gap-12" aria-hidden="true">
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-24 rounded-full bg-line/30" />
          ))}
        </div>
        <div className="h-12 w-3/4 rounded bg-line/30" />
        <div className="h-5 w-full rounded bg-line/20" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 w-full rounded-md bg-line/20" />
        ))}
        <div className="h-40 w-full rounded-md bg-line/20" />
      </div>
      <div className="hidden h-96 rounded-sm bg-line/20 md:block" />
    </div>
  );
}

export const WriteLetterClient = dynamic(
  () => import("@/components/WriteLetter").then((m) => m.WriteLetter),
  { ssr: false, loading: FormSkeleton },
);

export const WriteDateClient = dynamic(
  () => import("@/components/WriteDate").then((m) => m.WriteDate),
  { ssr: false, loading: FormSkeleton },
);

export const WriteVacationClient = dynamic(
  () => import("@/components/WriteVacation").then((m) => m.WriteVacation),
  { ssr: false, loading: FormSkeleton },
);

export const WriteGiftClient = dynamic(
  () => import("@/components/WriteGift").then((m) => m.WriteGift),
  { ssr: false, loading: FormSkeleton },
);
