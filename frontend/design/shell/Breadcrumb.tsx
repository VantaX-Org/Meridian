"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getPageTitle } from "@/lib/nav";
import { usePageTitleIsShown } from "./page-title-store";
import { Menu } from "../primitives/Menu";
import { useDrill, type Crumb } from "./useDrill";

const MAX_LEADING = 3;

/** Scope suffix after the title (e.g. object count, run). Pages publish it with `useBreadcrumbScope`; each part renders as its own element. */
let scope: readonly string[] = [];
const listeners = new Set<() => void>();
function setScope(next: readonly string[]) {
  scope = next;
  listeners.forEach((l) => l());
}
export function useBreadcrumbScope(parts: readonly string[]) {
  const key = parts.join("\u0000");
  useEffect(() => {
    setScope(key ? key.split("\u0000") : []);
    return () => setScope([]);
  }, [key]);
}

/** A detail page's own heading (a system's name) with the list page it belongs to as the crumb before it. */
export interface BreadcrumbTitle { label: string; parent: Crumb }
let detailTitle: BreadcrumbTitle | null = null;
const titleListeners = new Set<() => void>();
function setDetailTitle(next: BreadcrumbTitle | null) {
  detailTitle = next;
  titleListeners.forEach((l) => l());
}
/**
 * Publishes the current entity's name as the page's h1 (for routes the URL alone cannot name, such as
 * /systems/[id]), with its list page as the crumb before it. Cleared on unmount; null publishes nothing.
 * Every detail page calls this beside its `PageHeader`, so the document's one h1 is the entity's name and not
 * the list page's title: `useBreadcrumbTitle(system ? { label: system.name, parent: { label: "Systems", href: "/systems" } } : null)`.
 */
export function useBreadcrumbTitle(title: BreadcrumbTitle | null) {
  const label = title?.label ?? "";
  const parentLabel = title?.parent.label ?? "";
  const parentHref = title?.parent.href ?? "";
  useEffect(() => {
    setDetailTitle(label ? { label, parent: { label: parentLabel, href: parentHref } } : null);
    return () => setDetailTitle(null);
  }, [label, parentLabel, parentHref]);
}

function Dot() {
  return <span aria-hidden="true" className="shrink-0 rounded-full" style={{ width: 3, height: 3, background: "var(--m-ink-4)" }} />;
}

/** Crumbs beyond the last MAX_LEADING fold into a "…" menu. Own component so useRouter runs only when needed. */
function Overflow({ crumbs }: { crumbs: Crumb[] }) {
  const router = useRouter();
  return (
    <Menu
      trigger={<button type="button" aria-label="Earlier pages" className="m-text-meta m-ink-3">…</button>}
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
  const { crumbs: drill } = useDrill();
  const scopeParts = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => scope, () => scope);
  const detail = useSyncExternalStore((cb) => { titleListeners.add(cb); return () => { titleListeners.delete(cb); }; }, () => detailTitle, () => null);
  const pathname = usePathname();
  const pageDrawsTitle = usePageTitleIsShown();
  const crumbs: Crumb[] = drill.length > 0 ? drill : detail ? [detail.parent, { label: detail.label, href: pathname }] : [];
  const title = crumbs.length > 0 ? crumbs[crumbs.length - 1]!.label : getPageTitle(pathname);
  const leadingCrumbs = crumbs.slice(0, -1);
  const hidden = leadingCrumbs.slice(0, Math.max(0, leadingCrumbs.length - MAX_LEADING));
  const shown = leadingCrumbs.slice(hidden.length);
  return (
    <nav className="flex min-w-0 items-center gap-2 m-text-meta" aria-label="Breadcrumb">
      {hidden.length > 0 && (
        <>
          <Overflow crumbs={hidden} />
          <Dot />
        </>
      )}
      {shown.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-2">
          <Link href={crumb.href} className="m-motion-colors m-ink-3 hover:!text-[var(--m-ink)]">{crumb.label}</Link>
          <Dot />
        </span>
      ))}
      <h1 className={pageDrawsTitle ? "sr-only" : "m-text-h truncate font-semibold m-ink"}>
        {title}
      </h1>
      {scopeParts.map((part) => (
        // The page's own header carries its scope; shown here too, the line would keep the bar from collapsing.
        <span key={part} data-testid="crumb-scope" className={pageDrawsTitle ? "sr-only" : "truncate m-ink-3"}>{part}</span>
      ))}
    </nav>
  );
}
