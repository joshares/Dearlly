import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import { figtree, gloock, homemadeApple } from "@/app/fonts";
import { defaultLocale, getMessages } from "@/i18n";

import "./globals.css";

const t = getMessages();

export const metadata: Metadata = {
  title: t.meta.title,
  description: t.meta.description,
  // Not indexed until launch.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3EADB" },
    { media: "(prefers-color-scheme: dark)", color: "#1F2A6B" },
  ],
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
