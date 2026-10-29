"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVisibleNav } from "@/hooks/use-nav";
import { sectionTabs } from "@/lib/nav";

/**
 * The tab strip of a nav section (Rules, Processes): its page and sub-pages the viewer may open, from the visible
 * nav, so the More menu lists the section once. Pass it to the `PageHeader` `tabs` slot of each page in the section.
 */
export function SectionTabs({ label }: { label: string }) {
  const pathname = usePathname() ?? "";
  const tabs = sectionTabs(useVisibleNav(), pathname);
  if (!tabs.length) return null;
  return (
    <nav aria-label={label} className="m-tabs-list sm:flex-wrap">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined} className="m-tab m-motion-colors">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
