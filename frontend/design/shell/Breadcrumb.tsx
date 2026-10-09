"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPageTitle } from "@/lib/nav";
import { useDrill } from "./useDrill";

/**
 * Renders the drill trail (when the URL has one) and, always, the current
 * page as a single <h1> — the last crumb when drilled in, else the nav
 * title for this route (lib/nav.ts `getPageTitle`). Every page gets exactly
 * one document heading from this one place; no per-page title prop needed.
 */
export function Breadcrumb() {
  const { crumbs } = useDrill();
  const pathname = usePathname();
  const title = crumbs.length > 0 ? crumbs[crumbs.length - 1]!.label : getPageTitle(pathname);
  const leadingCrumbs = crumbs.slice(0, -1);
  return (
    <nav className="flex items-center gap-2 text-[13px] leading-[18px]" aria-label="Breadcrumb">
      {leadingCrumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-2">
          {i > 0 && <span style={{ color: "var(--m-ink-3)" }}>/</span>}
          <Link href={crumb.href} style={{ color: "var(--m-ink-3)" }}>{crumb.label}</Link>
        </span>
      ))}
      <span className="flex items-center gap-2">
        {leadingCrumbs.length > 0 && <span style={{ color: "var(--m-ink-3)" }}>/</span>}
        <h1 className="text-[15px] leading-[20px] font-semibold" style={{ color: "var(--m-ink)" }}>
          {title}
        </h1>
      </span>
    </nav>
  );
}
