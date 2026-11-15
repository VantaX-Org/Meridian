import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense, type ReactNode } from "react";
import { NextRoot } from "@/design/next/NextRoot";
import { Shell } from "@/design/next/shell/Shell";
import { NextRedirect } from "@/design/next/shell/NextRedirect";
import { LegacyFrame } from "@/design/next/shell/LegacyFrame";
import "@/design/next/tokens.css";
import "@/design/next/motion.css";
import "@/design/next/kit/kit.css";
import "@/design/next/kit/content.css";
import "@/design/next/layers.css";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import "@/design/v2/status.css";
import "@/design/v2/print.css";

const inter = localFont({ src: "../_fonts/Inter-latin-wght.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const jbmono = localFont({ src: "../_fonts/JetBrainsMono-latin-wght.woff2", weight: "100 800", variable: "--font-jbmono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { absolute: "Meridian" },
  description: "Every SAP object scored, every fix in one place",
};

// One interface: the Story feed shell around every page. Pages not yet rebuilt mount inside it through LegacyFrame.
export default function V2Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <NextRoot className={`${inter.variable} ${jbmono.variable}`}>
      <Suspense fallback={null}><NextRedirect /></Suspense>
      <Shell><LegacyFrame>{children}</LegacyFrame></Shell>
    </NextRoot>
  );
}
