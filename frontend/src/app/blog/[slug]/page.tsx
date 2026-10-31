import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleText } from "@/components/ArticleText";
import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { type Article, findArticle, readingMinutes } from "@/content/blog";
import { getMessages } from "@/i18n";
import { lagosDate } from "@/lib/dates";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();
const b = t.blog;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const article = findArticle((await params).slug);
  if (!article) return { title: t.notFound.metaTitle };
  const title = `${article.title} · Dearlly`;
  return {
    title,
    description: article.description,
    alternates: { canonical: `/blog/${article.slug}` },
    openGraph: {
      siteName: "Dearlly",
      type: "article",
      title,
      description: article.description,
      publishedTime: article.published,
      modifiedTime: article.updated ?? article.published,
    },
  };
}

export default async function ArticlePage({ params }: Params) {
  const article = findArticle((await params).slug);
  if (!article) notFound();
  return <ArticleView article={article} loggedIn={await seemsLoggedIn()} />;
}

export function ArticleView({ article, loggedIn }: { article: Article; loggedIn: boolean }) {
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-3xl pt-4 pr-5 pb-36 pl-9 md:px-12 md:pt-8 md:pb-24">
        <article className="letter-sheet flex flex-col gap-8 rounded-sm py-8 pr-4 pl-10 md:py-12 md:pr-12 md:pl-16">
          <header className="flex flex-col gap-3">
            <Link href="/blog" className="inline-flex min-h-12 items-center self-start text-sm font-bold underline">
              {b.allArticles}
            </Link>
            <h1 className="text-4xl leading-tight md:text-5xl">{article.title}</h1>
            <p className="text-sm text-muted">
              {(article.updated ? b.updated : b.published).replace("{date}", lagosDate(article.updated ?? article.published))}
              {" · "}
              {b.readMinutes.replace("{minutes}", String(readingMinutes(article)))}
            </p>
            {article.intro.map((text) => (
              <p key={text} className="text-lg leading-[1.8]">
                <ArticleText text={text} />
              </p>
            ))}
          </header>
          {article.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-3">
              <h2 className="text-2xl md:text-3xl">{section.heading}</h2>
              {section.paragraphs?.map((text) => (
                <p key={text} className="leading-[1.8]">
                  <ArticleText text={text} />
                </p>
              ))}
              {section.items && (
                <ul className="flex list-disc flex-col gap-3 pl-5 leading-[1.7]">
                  {section.items.map((item) => (
                    <li key={item.text}>
                      {item.lead && <strong>{item.lead} </strong>}
                      <ArticleText text={item.text} />
                    </li>
                  ))}
                </ul>
              )}
              {section.after?.map((text) => (
                <p key={text} className="leading-[1.8]">
                  <ArticleText text={text} />
                </p>
              ))}
            </section>
          ))}
          <section className="flex flex-col gap-3 border-t-2 border-dashed border-line pt-6">
            <h2 className="text-2xl md:text-3xl">{article.cta.heading}</h2>
            <p className="leading-[1.8]">{article.cta.body}</p>
            <Link href={article.cta.href}
              className="inline-flex min-h-14 items-center justify-center self-start rounded-lg bg-stamp px-6 text-lg font-extrabold text-paper no-underline shadow-[4px_4px_0_var(--color-ink)]">
              {article.cta.label}
            </Link>
          </section>
        </article>
      </main>
      <BottomNav t={t.nav} current="home" />
    </>
  );
}
