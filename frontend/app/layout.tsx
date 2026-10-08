import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Public_Sans, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/components/shell/toaster";
import { Providers } from "@/lib/providers";
import "./globals.css";

// One family, two widths: Next for the interface, Mono for SAP identifiers.
// Both were drawn so 0/O and 1/l/I never collide.
const sans = Atkinson_Hyperlegible_Next({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = Atkinson_Hyperlegible_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--m-font-sans-loaded",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--m-font-mono-loaded",
});

export const metadata: Metadata = {
  title: "Meridian",
  description: "SAP master-data quality, scored and routed to the people who fix it",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <html lang="en">
        <body
          className={`${sans.variable} ${mono.variable} ${publicSans.variable} ${jetbrainsMono.variable} font-sans antialiased`}
        >
          <Providers>
            {children}
            <Toaster />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
