import type { Metadata } from "next";

import { SiteHeader } from "@/components/SiteHeader";
import { getMessages } from "@/i18n";
import { seemsLoggedIn } from "@/lib/session";

const t = getMessages();

export const metadata: Metadata = { title: t.privacy.metaTitle };

export default async function PrivacyPage() {
  return <Privacy loggedIn={await seemsLoggedIn()} />;
}

/** The privacy notice (NDPA 2023). The words live in the messages file, so they can be translated. */
export function Privacy({ loggedIn }: { loggedIn: boolean }) {
  const p = t.privacy;
  return (
    <>
      <SiteHeader t={t.header} loggedIn={loggedIn} />
      <main className="mx-auto w-full max-w-3xl pt-4 pr-5 pb-24 pl-9 md:px-12 md:pt-8">
        <article className="letter-sheet flex flex-col gap-8 rounded-sm py-8 pr-6 pl-12 md:py-12 md:pr-12 md:pl-16">
          <header className="flex flex-col gap-3">
            <h1 className="text-4xl leading-tight md:text-5xl">{p.title}</h1>
            <p className="text-sm text-muted">{p.updated}</p>
            <p className="text-lg leading-[1.8]">{p.intro}</p>
          </header>
          {p.sections.map((section) => (
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
            <h2 className="text-2xl md:text-3xl">{p.contactHeading}</h2>
            <p className="leading-[1.8]">
              {p.contactBody}{" "}
              <a href={`mailto:${p.contactEmail}`} className="font-bold underline">
                {p.contactEmail}
              </a>
            </p>
          </section>
        </article>
      </main>
    </>
  );
}
