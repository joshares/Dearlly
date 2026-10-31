import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ARTICLES } from "@/content/blog";

import { Blog } from "../page";
import { ArticleView } from "./page";

afterEach(cleanup);

describe("blog", () => {
  it("lists every article with a link to it", () => {
    render(<Blog loggedIn={false} />);
    for (const article of ARTICLES) {
      expect(screen.getByRole("link", { name: new RegExp(article.title) }).getAttribute("href")).toBe(`/blog/${article.slug}`);
    }
  });

  it("shows an article with its sections, links and closing invitation", () => {
    const article = ARTICLES[0]!;
    render(<ArticleView article={article} loggedIn={false} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(article.title);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      ...article.sections.map((s) => s.heading),
      article.cta.heading,
    ]);
    const cta = screen.getByRole("link", { name: article.cta.label });
    expect(cta.getAttribute("href")).toBe(article.cta.href);
    expect(within(screen.getByRole("article")).getByRole("link", { name: "All articles" }).getAttribute("href")).toBe("/blog");
  });
});
