import localFont from "next/font/local";
import type { ReactNode } from "react";
import { NextRoot } from "@/design/next/NextRoot";
import { Shell } from "@/design/next/shell/Shell";
import "@/design/next/tokens.css";
import "@/design/next/motion.css";
import "@/design/next/kit/kit.css";
import "@/design/next/layers.css";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import "@/design/v2/status.css";
import "@/design/v2/print.css";

// Inter for words and figures, JetBrains Mono for SAP identifiers. Self-hosted (app/_fonts, latin subset, variable
// weight, SIL OFL 1.1), same mechanism as Geist in the root layout; tokens.css reads these two variables.
const inter = localFont({ src: "../_fonts/Inter-latin-wght.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const jbmono = localFont({ src: "../_fonts/JetBrainsMono-latin-wght.woff2", weight: "100 800", variable: "--font-jbmono", display: "swap", preload: false });

export default function NextLayout({ children }: { children: ReactNode }) {
  return <NextRoot className={`${inter.variable} ${jbmono.variable}`}><Shell>{children}</Shell></NextRoot>;
}
