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

// Role reference — mirrors api/services/rbac.py PERMISSIONS matrix.
const ROLE_OPTIONS = [
  {
    role: "admin",
    label: "Admin",
    badge: "bg-[#0057D2]/10 text-[#0057D2]",
    tooltip: "Full access including tenant administration",
    perms: { view: true, approve: true, manage: true, aiReview: true },
  },
  {
    role: "steward",
    label: "Steward",
    badge: "bg-[#0B7341]/10 text-[#0B7341]",
    tooltip: "Approve data actions and approve proposed rules",
    perms: { view: true, approve: true, manage: false, aiReview: true },
  },
  {
    role: "ai_reviewer",
    label: "AI Reviewer",
    badge: "bg-[#7C3AED]/10 text-[#7C3AED]",
    tooltip: "Review AI confidence and approve proposed rules; cannot approve data actions",
    perms: { view: true, approve: false, manage: false, aiReview: true },
  },
  {
    role: "viewer",
    label: "Viewer",
    badge: "bg-[#64748B]/10 text-[#64748B]",
    tooltip: "Read-only access",
    perms: { view: true, approve: false, manage: false, aiReview: false },
  },
];

const PERM_COLS: { key: keyof (typeof ROLE_OPTIONS)[number]["perms"]; label: string }[] = [
  { key: "view", label: "View" },
  { key: "approve", label: "Approve Data" },
  { key: "manage", label: "Manage Config" },
  { key: "aiReview", label: "AI Review" },
];

function TeamRolesReference() {
  return (
    <section className="vx-card mt-6 p-4">
      <div className="mb-3">
        <div className="mn-settings-title">Team Roles</div>
        <div className="mn-settings-sub">
          Permission reference for roles assignable under Admin.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--mn-ink-400)]">
              <th className="py-2 pr-4">Role</th>
              {PERM_COLS.map((c) => (
                <th key={c.key} className="py-2 pr-4 text-center">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_OPTIONS.map((r) => (
              <tr key={r.role} className="border-t border-[var(--mn-line)]">
                <td className="py-2 pr-4">
                  <span
                    title={r.tooltip}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.badge}`}
                  >
                    {r.label}
                  </span>
                </td>
                {PERM_COLS.map((c) => (
                  <td key={c.key} className="py-2 pr-4 text-center text-[var(--mn-ink-500)]">
                    {r.perms[c.key] ? "✓" : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
      <TeamRolesReference />
    </>
  );
}
