import type { Metadata, Viewport } from "next";
import { Public_Sans, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/design";
import { Providers } from "@/lib/providers";
import brand from "../public/brand/brand.json";
import "./globals.css";

// Public Sans for UI, JetBrains Mono for SAP identifiers. tokens.css reads --font-ui and --font-mono.
const sans = Public_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ui", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

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
      {/* Font variables sit on <html> so tokens.css (:root) can resolve --font-ui and --font-mono. */}
      <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
        <head>
          {/* Sets data-theme before first paint; keys match hooks/use-theme.ts (old aurora:theme is read as a fallback). "system" leaves it to prefers-color-scheme in tokens.css, but is resolved here too so dark users never flash light. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem("meridian:theme")||localStorage.getItem("aurora:theme")||"light";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`,
            }}
          />
        </head>
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
