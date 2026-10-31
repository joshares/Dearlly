/**
 * A blog article, kept as plain data (no blogging service, nothing to pay for).
 * In any text, [words](/path) becomes a link to a Dearlly page (only our own pages).
 */
export type Article = {
  slug: string; // its address: dearlly.app/blog/<slug>
  title: string;
  // Shorter title for the link preview picture.
  cardTitle: string;
  description: string; // under the title in Google and in link previews
  published: string; // YYYY-MM-DD
  updated?: string;
  intro: string[];
  sections: {
    heading: string;
    paragraphs?: string[];
    items?: { lead?: string; text: string }[];
    after?: string[];
  }[];
  cta: { heading: string; body: string; label: string; href: string };
};
