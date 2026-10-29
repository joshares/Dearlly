"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import { TURNSTILE_ORIGIN } from "@/lib/security-headers";

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Cloudflare's public test key (always passes) unless a real one is configured.
export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";

/** Cloudflare's bot check. Calls onToken with a token once passed, or null when it expires. */
export function Turnstile({
  nonce,
  onToken,
}: {
  nonce?: string;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const callback = useRef(onToken);

  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const api = window.turnstile;
    if (!loaded || !api || !container.current) return;
    const widgetId = api.render(container.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "auto",
      // The normal widget is 300px wide: too wide for small phones inside the letter sheet.
      size: window.innerWidth < 420 ? "compact" : "normal",
      callback: (token: string) => callback.current(token),
      "expired-callback": () => callback.current(null),
      "error-callback": () => callback.current(null),
    });
    return () => api.remove(widgetId);
  }, [loaded]);

  return (
    <>
      <Script
        src={`${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`}
        nonce={nonce}
        strategy="afterInteractive"
        onReady={() => setLoaded(true)}
      />
      <div ref={container} className="min-h-16" />
    </>
  );
}
