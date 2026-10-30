import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/status.css";
import { StandaloneRoot } from "@/design/v2/shell/Standalone";

// The same self-hosted faces as the shell (app/(v2)/layout.tsx).
const plexSans = localFont({
  src: [
    { path: "../_fonts/IBMPlexSans-latin-400.woff2", weight: "400", style: "normal" },
    { path: "../_fonts/IBMPlexSans-latin-500.woff2", weight: "500", style: "normal" },
    { path: "../_fonts/IBMPlexSans-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = localFont({
  src: [{ path: "../_fonts/IBMPlexMono-latin-400.woff2", weight: "400", style: "normal" }],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Meridian: SAP data quality, scored and routed to the people who fix it",
};

/** The signed-out pages: sign in, forgot and reset password, accept an invitation, licence needed. No map, no canvas. */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`m2-fonts ${plexSans.variable} ${plexMono.variable}`}>
      <StandaloneRoot>{children}</StandaloneRoot>
    </div>
  );
}
