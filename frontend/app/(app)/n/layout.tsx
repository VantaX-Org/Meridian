import localFont from "next/font/local";
import type { ReactNode } from "react";
import "@/ui/tokens.css";
import "@/ui/kit/kit.css";
import { Frame } from "./Frame";

const plexSans = localFont({ src: [{ path: "../../_fonts/IBMPlexSans-latin-400.woff2", weight: "400" }, { path: "../../_fonts/IBMPlexSans-latin-500.woff2", weight: "500" }, { path: "../../_fonts/IBMPlexSans-latin-600.woff2", weight: "600" }], variable: "--font-plex-sans", display: "swap" });
const plexMono = localFont({ src: "../../_fonts/IBMPlexMono-latin-400.woff2", weight: "400", variable: "--font-plex-mono", display: "swap", preload: false });

export default function UiLayout({ children }: { children: ReactNode }) {
  return <div className={`${plexSans.variable} ${plexMono.variable}`}><Frame>{children}</Frame></div>;
}
