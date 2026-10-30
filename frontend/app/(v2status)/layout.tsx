import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import "@/design/v2/status.css";
import { StandaloneRoot } from "@/design/v2/shell/Standalone";

// The same self-hosted faces as the v2 shell (app/(v2)/layout.tsx); this group has no map, canvas or inspector.
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
  title: "Status",
  description: "Whether the platform is working: its components, the last 30 days, incidents and planned maintenance",
};

/** Pages that stand without the shell: the status page, at /v2/status (public) and /status (signed in). */
export default function StandaloneLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={`m2-fonts ${plexSans.variable} ${plexMono.variable}`}>
      <StandaloneRoot>{children}</StandaloneRoot>
    </div>
  );
}
