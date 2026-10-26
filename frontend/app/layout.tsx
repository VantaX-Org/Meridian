import type { Metadata, Viewport } from "next";
import { Manrope, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Attribution, Toaster } from "@/design";
import { Providers } from "@/lib/providers";
import { themeBootScript } from "@/lib/theme";
import brand from "../public/brand/brand.json";
import "./globals.css";

// Manrope for UI and numerals, JetBrains Mono for SAP identifiers. tokens.css reads --font-ui and --font-jbm.
const sans = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jbm", display: "swap" });

export const metadata: Metadata = {
  title: "Meridian",
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
      {/* Font variables sit on <html> so tokens.css (:root) can resolve --font-ui and --font-jbm. */}
      <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
        <head>
          {/* Sets data-theme before first paint from the keys lib/preferences.ts writes, defaulting to DEFAULT_THEME (lib/theme.ts). */}
          <script
            dangerouslySetInnerHTML={{
              __html: themeBootScript(),
            }}
          />
        </head>
        <body className="font-sans antialiased">
          <Providers>
            {children}
            <Toaster />
            <Attribution />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
