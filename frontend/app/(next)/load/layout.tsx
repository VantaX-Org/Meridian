import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Load" };

// The (next) layout already wraps this route in the shared Shell (top bar, auth, permissions).
export default function LoadLayout({ children }: { children: ReactNode }) {
  return children;
}
