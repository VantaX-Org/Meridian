import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meridian HQ",
  description: "Manage your Meridian licence and billing",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `data-theme="dark"` activates the Aurora dark token set from
  // aurora.css (mirrored from the customer frontend). The portal is
  // dark-first to match.
  return (
    <html lang="en" className="dark" data-theme="dark">
      <body className="min-h-screen antialiased aurora-text-body">
        {children}
      </body>
    </html>
  );
}
