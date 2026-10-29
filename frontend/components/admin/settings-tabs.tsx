"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useVisibleNav } from "@/hooks/use-nav";
import { settingsTabs } from "@/lib/nav";

/**
 * The admin area's one tab strip: Overview, Users, Roles and access, Sign-in, Alerts, Triage, Field mapping,
 * Reference data, Jobs, Audit log, Billing and Licence, each only when the viewer may open it (from the visible nav,
 * so a tab never leads to a page the role cannot use). Pass it to the `PageHeader` `tabs` slot of each admin page.
 */
export function SettingsTabs() {
  const pathname = usePathname() ?? "";
  const tabs = settingsTabs(useVisibleNav());
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Admin pages" className="m-tabs-list flex-wrap">
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
