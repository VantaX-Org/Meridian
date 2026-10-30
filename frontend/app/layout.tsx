import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/lib/auth-provider";
import { Attribution } from "@/design/brand/Attribution";
import { Providers } from "@/lib/providers";
import { themeBootScript } from "@/lib/theme";
import brand from "../public/brand/brand.json";
import "./globals.css";

// IBM Plex Sans for words and figures, IBM Plex Mono for SAP identifiers, loaded once here for every page (the shell,
// the signed-out pages, the status page, not found and the global error). Self-hosted (app/_fonts, latin subset,
// SIL OFL 1.1) so builds and offline customer deployments never fetch from Google Fonts. design/v2/tokens.css reads
// --font-plex-sans and --font-plex-mono; design/tokens.css falls back to the same faces.
const plexSans = localFont({
  src: [
    { path: "./_fonts/IBMPlexSans-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./_fonts/IBMPlexSans-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./_fonts/IBMPlexSans-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = localFont({
  src: [{ path: "./_fonts/IBMPlexMono-latin-400.woff2", weight: "400", style: "normal" }],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Meridian", template: "%s – Meridian" },
  description: "SAP master-data quality, scored and routed to the people who fix it",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brand.canvas },
    { media: "(prefers-color-scheme: dark)", color: brand.canvasDark },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      {/* Font variables sit on <html> so both token files (:root and .m2-root) resolve the Plex faces. */}
      <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
        <head>
          {/* Sets data-theme before first paint from the keys lib/preferences.ts writes, defaulting to DEFAULT_THEME (lib/theme.ts). */}
          <script
            dangerouslySetInnerHTML={{
              __html: themeBootScript(),
            }}
          />
        </head>
        <body className="flex min-h-dvh flex-col font-sans antialiased">
          <Providers>
            {children}
            <Attribution />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
