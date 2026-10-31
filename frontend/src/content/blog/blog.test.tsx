import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ArticleText } from "@/components/ArticleText";

import { ARTICLES, readingMinutes } from ".";

afterEach(cleanup);

// Pages an article may link to (with or without something after them, like /date-ideas/lagos).
const PAGES = ["/write", "/write/date", "/write/vacation", "/write/gift", "/quotes", "/date-ideas", "/games", "/blog"];

function allText(article: (typeof ARTICLES)[number]): string[] {
  return [
    ...article.intro,
    ...article.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.items ?? []).map((i) => i.text), ...(s.after ?? [])]),
  ];
}

describe("blog articles", () => {
  it("each have their own address, a date, and a short enough picture title", () => {
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
    for (const article of ARTICLES) {
      expect(article.slug).toMatch(/^[a-z0-9-]+$/);
      expect(article.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(article.cardTitle.length, article.slug).toBeLessThanOrEqual(36);
      expect(article.description.length, article.slug).toBeLessThanOrEqual(200);
      expect(readingMinutes(article)).toBeGreaterThan(1);
    }
  });

  it("only link to pages that exist", () => {
    for (const article of ARTICLES) {
      const links = allText(article).flatMap((text) => [...text.matchAll(/\]\(([^)]*)\)/g)].map((m) => m[1]!));
      for (const href of [...links, article.cta.href]) {
        expect(PAGES.some((page) => href === page || href.startsWith(`${page}/`)), `${article.slug}: ${href}`).toBe(true);
      }
    }
  });
});

describe("article text", () => {
  it("turns [words](/page) into a link", () => {
    render(<p><ArticleText text="See our [date ideas](/date-ideas) first." /></p>);
    expect(screen.getByRole("link", { name: "date ideas" }).getAttribute("href")).toBe("/date-ideas");
  });

  it("never links outside Dearlly", () => {
    render(<p><ArticleText text="A [bad link](https://example.com) and [another](javascript:alert(1))." /></p>);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
