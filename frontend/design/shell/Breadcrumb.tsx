"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getPageTitle } from "@/lib/nav";
import { Menu } from "../primitives/Menu";
import { useDrill, type Crumb } from "./useDrill";

const MAX_LEADING = 3;

function Dot() {
  return <span aria-hidden="true" className="shrink-0 rounded-full" style={{ width: 3, height: 3, background: "var(--m-ink-4)" }} />;
}

/** Crumbs beyond the last MAX_LEADING fold into a "…" menu. Own component so useRouter runs only when needed. */
function Overflow({ crumbs }: { crumbs: Crumb[] }) {
  const router = useRouter();
  return (
    <Menu
      trigger={<button type="button" aria-label="Earlier pages" className="text-[12px] leading-[16px]" style={{ color: "var(--m-ink-3)" }}>…</button>}
      items={crumbs.map((c) => ({ label: c.label, onSelect: () => router.push(c.href) }))}
    />
  );
}

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
  const hidden = leadingCrumbs.slice(0, Math.max(0, leadingCrumbs.length - MAX_LEADING));
  const shown = leadingCrumbs.slice(hidden.length);
  return (
    <nav className="flex min-w-0 items-center gap-2 text-[12px] leading-[16px]" aria-label="Breadcrumb">
      {hidden.length > 0 && (
        <>
          <Overflow crumbs={hidden} />
          <Dot />
        </>
      )}
      {shown.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-2">
          <Link href={crumb.href} className="m-motion-colors hover:!text-[var(--m-ink)]" style={{ color: "var(--m-ink-3)" }}>{crumb.label}</Link>
          <Dot />
        </span>
      ))}
      <h1 className="m-text-h truncate font-semibold" style={{ color: "var(--m-ink)" }}>
        {title}
      </h1>
    </nav>
  );
}
