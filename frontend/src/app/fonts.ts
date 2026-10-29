import localFont from "next/font/local";

// Self-hosted (files in src/fonts, with their licences): no request to Google at runtime.
export const gloock = localFont({
  src: "../fonts/gloock-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-gloock",
  display: "swap",
});

export const figtree = localFont({
  src: "../fonts/figtree-latin-wght-normal.woff2",
  weight: "300 900",
  variable: "--font-figtree",
  display: "swap",
});

// Handwriting is decoration only, so it isn't preloaded (saves data on slow connections).
export const homemadeApple = localFont({
  src: "../fonts/homemade-apple-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-homemade-apple",
  display: "swap",
  preload: false,
});
