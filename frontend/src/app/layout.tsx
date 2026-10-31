import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { figtree, gloock, homemadeApple } from "@/app/fonts";
import { defaultLocale, getMessages } from "@/i18n";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

const t = getMessages();

export const metadata: Metadata = {
  title: t.meta.title,
  description: t.meta.description,
  metadataBase: new URL(SITE_URL),
  // Which pages search engines may list is decided in src/proxy.ts (src/lib/site.ts).
  openGraph: { siteName: "Dearlly", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F3EADB",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes each page render per request, so Next.js can stamp
  // its scripts with that request's CSP nonce (see src/proxy.ts).
  await headers();
  return (
    <html
      lang={defaultLocale}
      className={`${gloock.variable} ${figtree.variable} ${homemadeApple.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <div className="airmail-frame" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
