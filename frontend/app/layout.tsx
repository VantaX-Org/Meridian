import type { Metadata, Viewport } from "next";
import { Public_Sans, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/design";
import { Providers } from "@/lib/providers";
import brand from "../public/brand/brand.json";
import "./globals.css";

// DESIGN.md: Public Sans for UI text, JetBrains Mono for SAP identifiers. tokens.css reads these as --m-font-*.
const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--m-font-sans-loaded",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--m-font-mono-loaded",
});

export const metadata: Metadata = {
  title: "Meridian",
  description: "SAP master-data quality, scored and routed to the people who fix it",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
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
      <html lang="en" className={`${publicSans.variable} ${jetbrainsMono.variable}`}>
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
