"use client";

import Link from "next/link";
import { useDrill } from "./useDrill";

export function Breadcrumb() {
  const { crumbs } = useDrill();
  if (crumbs.length === 0) return null;
  return (
    <nav className="flex items-center gap-1 text-[13px]" style={{ color: "var(--m-ink-2)" }} aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <span>/</span>}
          <Link href={crumb.href} style={{ color: "var(--m-ink)" }}>{crumb.label}</Link>
        </span>
      ))}
    </nav>
  );
}
