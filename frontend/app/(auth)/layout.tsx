import type { Metadata } from "next";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/status.css";
import { StandaloneRoot } from "@/design/v2/shell/Standalone";


export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Meridian: SAP data quality, scored and routed to the people who fix it",
};

/** The signed-out pages: sign in, forgot and reset password, accept an invitation, licence needed. No map, no canvas. */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="m2-fonts">
      <StandaloneRoot>{children}</StandaloneRoot>
    </div>
  );
}
