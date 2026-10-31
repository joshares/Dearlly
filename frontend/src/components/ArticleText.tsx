import Link from "next/link";
import { Fragment } from "react";

/** Text with [words](/path) links to our own pages. Anything else stays plain text. */
export function ArticleText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(\/[a-z0-9/_-]*\))/);
  return parts.map((part, i) => {
    const link = /^\[([^\]]+)\]\((\/[a-z0-9/_-]*)\)$/.exec(part);
    if (!link) return <Fragment key={i}>{part}</Fragment>;
    return (
      <Link key={i} href={link[2]!} className="font-bold underline">
        {link[1]}
      </Link>
    );
  });
}
