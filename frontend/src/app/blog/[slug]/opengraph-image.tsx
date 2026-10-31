import { findArticle, readingMinutes } from "@/content/blog";
import { getMessages } from "@/i18n";
import { OG_SIZE, OG_TYPE, ogImage } from "@/lib/og";

// Shared links to an article: its short title and how long it takes to read.
const t = getMessages();

export const alt = t.blog.title;
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const article = findArticle((await params).slug);
  return ogImage({
    kicker: t.blog.kicker,
    title: article?.cardTitle ?? t.blog.title,
    line: article ? t.blog.readMinutes.replace("{minutes}", String(readingMinutes(article))) : t.blog.lead,
    site: t.og.site,
  });
}
