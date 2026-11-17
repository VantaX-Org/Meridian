import type { Metadata } from "next";
import "@/ui/tokens.css";
import "@/ui/kit/kit.css";
import "@/ui/auth/auth.css";
import { Standalone } from "@/ui/kit/Standalone";
import { plexClass } from "../fonts";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Meridian: SAP data quality, scored and routed to the people who fix it",
};

/** The signed-out pages: sign in, forgot and reset password, accept an invitation, licence needed. No map, no canvas. */
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={plexClass}>
      <Standalone>{children}</Standalone>
    </div>
  );
}
