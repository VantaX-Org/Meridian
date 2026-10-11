import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/design";
import { Providers } from "@/lib/providers";
import brand from "../public/brand/brand.json";
import "./globals.css";

// DESIGN.md: Instrument Sans for UI, Instrument Serif for verdicts only, JetBrains Mono for SAP identifiers.
// tokens.css reads these as --m-font-*-loaded.
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--m-font-sans-loaded", display: "swap" });
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--m-font-display-loaded", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--m-font-mono-loaded", display: "swap" });

export const metadata: Metadata = {
  title: "Meridian",
  description: "SAP master-data quality, scored and routed to the people who fix it",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  openGraph: { images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }] },
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
      {/* Font variables sit on <html> so tokens.css (:root) can resolve --m-font-*-loaded. */}
      <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
        <body className="font-sans antialiased">
          <Providers>
            {children}
            <Toaster />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
