"use client";

import dynamic from "next/dynamic";

// The draft is read from this device's storage, so the form renders in the browser only
// (no server render that could disagree with the saved draft).
export const WriteLetterClient = dynamic(
  () => import("@/components/WriteLetter").then((m) => m.WriteLetter),
  { ssr: false },
);

export const WriteDateClient = dynamic(
  () => import("@/components/WriteDate").then((m) => m.WriteDate),
  { ssr: false },
);
