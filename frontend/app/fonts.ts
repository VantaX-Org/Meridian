import localFont from "next/font/local";

/** IBM Plex faces behind --font-plex-sans and --font-plex-mono (ui/tokens.css), shared by the app, sign-in and not-found layouts. */
export const plexSans = localFont({ src: [{ path: "./_fonts/IBMPlexSans-latin-400.woff2", weight: "400" }, { path: "./_fonts/IBMPlexSans-latin-500.woff2", weight: "500" }, { path: "./_fonts/IBMPlexSans-latin-600.woff2", weight: "600" }], variable: "--font-plex-sans", display: "swap" });
export const plexMono = localFont({ src: "./_fonts/IBMPlexMono-latin-400.woff2", weight: "400", variable: "--font-plex-mono", display: "swap", preload: false });
export const plexClass = `${plexSans.variable} ${plexMono.variable}`;
