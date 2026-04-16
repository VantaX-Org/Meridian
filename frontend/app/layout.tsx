import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/lib/providers";
import "./globals.css";

const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meridian — SAP Data Quality Agent",
  description: "Analyse and improve SAP data quality for S/4HANA migration",
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
          className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}
          style={{ ["--font-display" as string]: "var(--font-sans)" }}
        >
          <Providers>
            {children}
            <Toaster richColors position="top-right" />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
