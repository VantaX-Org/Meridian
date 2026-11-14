import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Object" };

// The next shell around it is the only shell; the v2 tabs get their token scope from the page.
export default function ObjectLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
