"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVisibleNav } from "@/hooks/use-nav";
import { settingsTabs } from "@/lib/nav";

/**
 * The tab strip of Settings (DESIGN.md: "Settings with its tabs"): the overview and every Settings page the viewer
 * may open, from the visible nav, so a tab never leads to a page the role cannot use. The More menu lists Settings
 * once and these pages are reached from here. Pass it to the `PageHeader` `tabs` slot of each Settings page.
 */
export function SettingsTabs() {
  const pathname = usePathname() ?? "";
  const tabs = settingsTabs(useVisibleNav());
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Settings pages" className="m-tabs-list sm:flex-wrap">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={pathname === t.href ? "page" : undefined}
          className="m-tab m-motion-colors"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
