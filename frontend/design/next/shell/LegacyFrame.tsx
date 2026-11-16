"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { redirectFor } from "@/lib/next/nav-defaults";
import { LegacyMount } from "./LegacyMount";

/** Addresses under app/(v2) whose page is already a new screen. Every other (v2) page is an older screen, mounted unchanged inside the new shell until its own rebuild lands. */
export function isNativePath(p: string): boolean {
  return p === "/" || p === "/work" || p === "/runs" || p.startsWith("/run/");
}

export function LegacyFrame({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  // An old address is about to move (NextRedirect): render nothing, so no one types into a screen that remounts.
  if (redirectFor(path)) return null;
  return isNativePath(path) ? <>{children}</> : <LegacyMount>{children}</LegacyMount>;
}
