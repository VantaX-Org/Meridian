import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { AuthProvider } from "@/lib/auth-provider";
import { Attribution } from "@/design/brand/Attribution";
import { Providers } from "@/lib/providers";
import { themeBootScript } from "@/lib/theme";
import brand from "../public/brand/brand.json";
import "./globals.css";

// Geist for words and figures, Geist Mono for SAP identifiers, loaded once here for every page (the shell, the
// signed-out pages, the status page, not found and the global error). Self-hosted (app/_fonts, latin subset, variable
// weight, SIL OFL 1.1) so builds and offline customer deployments never fetch from a font service. design/v2/tokens.css
// reads --font-geist-sans and --font-geist-mono; design/tokens.css falls back to the same faces.
const geistSans = localFont({
  src: "./_fonts/Geist-latin-wght.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
  display: "swap",
});
const geistMono = localFont({
  src: "./_fonts/GeistMono-latin-wght.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
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
  themeColor: brand.canvas,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // proxy.ts mints one nonce per request; reading it makes every page render per request, which a nonce needs.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <AuthProvider>
      {/* Font variables sit on <html> so both token files (:root and .m2-root) resolve the Plex faces. */}
      <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
        <head>
          {/* Sets data-theme before first paint from the keys lib/preferences.ts writes, defaulting to DEFAULT_THEME (lib/theme.ts). */}
          <script
            nonce={nonce}
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
