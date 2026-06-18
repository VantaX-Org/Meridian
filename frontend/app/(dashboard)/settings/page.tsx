"use client";

import Link from "next/link";
import { PageHead } from "@/components/meridian/atoms";
import { ChevronRight } from "lucide-react";

const SETTINGS_NAV = [
  {
    k: "rules",
    l: "Rules Engine",
    d: "Built-in + custom rules · triggers + scheduling",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
        <circle cx="9" cy="6" r="2.3" fill="white" />
        <circle cx="15" cy="12" r="2.3" fill="white" />
        <circle cx="8" cy="18" r="2.3" fill="white" />
      </svg>
    ),
    route: "/settings/rules",
  },
  {
    k: "field-mapping",
    l: "Field Mapping",
    d: "Source-to-canonical field maps per domain",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="3 6 9 4 15 6 21 4 21 18 15 20 9 18 3 20 3 6" />
        <line x1="9" y1="4" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="20" />
      </svg>
    ),
    route: "/settings/field-mapping",
  },
  {
    k: "licence",
    l: "Licence",
    d: "Tier, seats, renewal & enabled modules",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="15" r="4" />
        <line x1="11" y1="12" x2="21" y2="2" />
        <line x1="17" y1="6" x2="20" y2="9" />
        <line x1="15" y1="8" x2="18" y2="11" />
      </svg>
    ),
    route: "/settings/licence",
  },
];

export default function SettingsIndexPage() {
  return (
    <>
      <PageHead
        title="Settings"
        route="/settings"
        sub={
          <>
            Configure how Meridian operates — rule engine triggers, field mapping schemas, and licence. User management lives under{" "}
            <Link className="mn-link" href="/admin" style={{ padding: 0, margin: 0 }}>
              Admin
            </Link>
            .
          </>
        }
      />
      <div className="mn-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {SETTINGS_NAV.map((s) => (
          <Link key={s.k} href={s.route} className="mn-settings-card">
            <div className="mn-settings-icon">{s.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mn-settings-title">{s.l}</div>
              <div className="mn-settings-sub">{s.d}</div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--mn-ink-300)" }} />
          </Link>
        ))}
      </div>
    </>
  );
}
