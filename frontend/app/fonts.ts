import localFont from "next/font/local";

/** Geist faces behind --font-geist-sans and --font-geist-mono (ui/tokens.css), shared by the app, sign-in and not-found layouts. */
export const geistSans = localFont({ src: "./_fonts/Geist-latin-wght.woff2", weight: "100 900", variable: "--font-geist-sans", display: "swap" });
export const geistMono = localFont({ src: "./_fonts/GeistMono-latin-wght.woff2", weight: "100 900", variable: "--font-geist-mono", display: "swap", preload: false });
export const plexClass = `${geistSans.variable} ${geistMono.variable}`;
