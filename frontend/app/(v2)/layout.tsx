import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import { V2Shell } from "@/design/v2/shell/V2Shell";

// IBM Plex Sans for words and figures, IBM Plex Mono for SAP identifiers. Self-hosted (app/_fonts, latin subset,
// SIL OFL 1.1) so builds and offline customer deployments never fetch from Google Fonts. tokens.css reads
// --font-plex-sans and --font-plex-mono.
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
  title: "Meridian",
  description: "The SAP landscape as one map: every system and object scored, every fix in one place",
};

export default function V2Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`m2-fonts ${plexSans.variable} ${plexMono.variable}`}>
      <V2Shell>{children}</V2Shell>
    </div>
  );
}
