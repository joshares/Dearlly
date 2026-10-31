import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";

const t = getMessages();

export type LegalDoc = {
  title: string;
  updated: string;
  intro: string;
  sections: { heading: string; paragraphs: string[]; items?: string[] }[];
  contactHeading: string;
  contactBody: string;
  contactEmail: string;
};

/** Privacy, Terms and Safety: the same letter-paper page, with words from the messages file. */
export function LegalPage({ doc, loggedIn }: { doc: LegalDoc; loggedIn: boolean }) {
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-3xl pt-4 pr-5 pb-24 pl-9 md:px-12 md:pt-8">
        <article className="letter-sheet flex flex-col gap-8 rounded-sm py-8 pr-6 pl-12 md:py-12 md:pr-12 md:pl-16">
          <header className="flex flex-col gap-3">
            <h1 className="text-4xl leading-tight md:text-5xl">{doc.title}</h1>
            <p className="text-sm text-muted">{doc.updated}</p>
            <p className="text-lg leading-[1.8]">{doc.intro}</p>
          </header>
          {doc.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-3">
              <h2 className="text-2xl md:text-3xl">{section.heading}</h2>
              {section.paragraphs.map((text) => (
                <p key={text} className="leading-[1.8]">
                  {text}
                </p>
              ))}
              {section.items && (
                <ul className="flex list-disc flex-col gap-2 pl-5 leading-[1.7]">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <section className="flex flex-col gap-3 border-t-2 border-dashed border-line pt-6">
            <h2 className="text-2xl md:text-3xl">{doc.contactHeading}</h2>
            <p className="leading-[1.8]">
              {doc.contactBody}{" "}
              <a href={`mailto:${doc.contactEmail}`} className="font-bold underline">
                {doc.contactEmail}
              </a>
            </p>
          </section>
        </article>
      </main>
    </>
  );
}
