"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LegacyMount } from "./LegacyMount";

/** Addresses under app/(v2) whose page is already a new screen. Every other (v2) page is an older screen, mounted unchanged inside the new shell until its own rebuild lands. */
export function isNativePath(p: string): boolean {
  return p === "/" || p === "/work" || p === "/runs" || p.startsWith("/run/");
}

export function LegacyFrame({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  return isNativePath(path) ? <>{children}</> : <LegacyMount>{children}</LegacyMount>;
}
