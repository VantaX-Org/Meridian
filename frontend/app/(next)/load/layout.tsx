import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Load" };

// The (next) layout already gives Load the next shell and its inspector; the v2 screens on the tabs mount through LegacyMount.
export default function LoadLayout({ children }: { children: ReactNode }) {
  return children;
}
