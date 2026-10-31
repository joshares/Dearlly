import type { Article } from "./types";
import { valentinesDayIdeas } from "./valentines-day-ideas";

export type { Article } from "./types";

/** Newest first. Add an article: make its file, then list it here. */
export const ARTICLES: Article[] = [valentinesDayIdeas];

export function findArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/** About 220 words a minute, rounded up. */
export function readingMinutes(article: Article): number {
  const text = [
    ...article.intro,
    ...article.sections.flatMap((s) => [
      s.heading,
      ...(s.paragraphs ?? []),
      ...(s.items ?? []).map((i) => `${i.lead ?? ""} ${i.text}`),
      ...(s.after ?? []),
    ]),
  ].join(" ");
  return Math.max(1, Math.ceil(text.split(/\s+/).length / 220));
}
