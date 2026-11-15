import type { Metadata } from "next";
import localFont from "next/font/local";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/status.css";
import "@/design/next/tokens.css";
import "@/design/next/kit/kit.css";
import "@/design/next/auth.css";
import { StandaloneRoot } from "@/design/v2/shell/Standalone";
import { NextRoot } from "@/design/next/NextRoot";

const inter = localFont({ src: "../_fonts/Inter-latin-wght.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Meridian: SAP data quality, scored and routed to the people who fix it",
};

/**
 * The signed-out pages: sign in, forgot and reset password, accept an invitation, licence needed. No map, no canvas.
 * The v2 root keeps the language, tenant accent and demo bar; the next root inside it gives the pages the next tokens,
 * and design/next/auth.css draws the card, fields and buttons with them.
 */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="m2-fonts">
      <StandaloneRoot>
        <NextRoot className={`nx-auth ${inter.variable}`}>{children}</NextRoot>
      </StandaloneRoot>
    </div>
  );
}
