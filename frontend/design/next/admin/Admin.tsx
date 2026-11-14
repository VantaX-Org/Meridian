"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AdminCanvas } from "@/design/v2/admin/Admin";
import { ADMIN_SECTIONS, canAdminister, isAdminSlug, visibleSections } from "@/lib/v2/admin-sections";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { LegacyMount } from "../shell/LegacyMount";
import { Denied } from "../more/states";
import { EmptyState } from "../kit";
import { ChartCard } from "../more/ChartCard";
import { SeatsCard, UsersCard } from "../more/cards";
import { Roles } from "./Roles";
import { Users } from "./Users";

/** Administration: five chart-led cards, one per group, each listing the sections this person may open. The one entry to admin. */
export function AdminHome() {
  const { can } = useV2Session();
  const href = useV2Href();
  const groups = useMemo(() => {
    const out = new Map<string, ReturnType<typeof visibleSections>>();
    for (const s of visibleSections(can)) out.set(s.group, [...(out.get(s.group) ?? []), s]);
    return [...out.entries()];
  }, [can]);
  if (!canAdminister(can)) return <Denied what={t("Administration")} />;
  return (
    <div className="nx-chartcards" data-testid="admin-cards">
      {groups.map(([group, items]) => {
        const list = (
          <ul className="nx-chartcard-list">
            {items.map((s) => (
              <li key={s.slug}><Link className="nx-link" href={href(`/more/admin/${s.slug}`)}>{s.label}</Link><span className="nx-sub"> {s.lead}</span></li>
            ))}
          </ul>
        );
        // The two groups with real figures lead with them; the rest draw the chart's empty shape, never a made-up number.
        if (group === t("People and access")) return <UsersCard key={group} title={group}>{list}</UsersCard>;
        if (group === t("Tenant")) return <SeatsCard key={group} title={group}>{list}</SeatsCard>;
        return <ChartCard key={group} title={group} state="empty" chart={null} emptyLine={t("No usage figures for this group yet.")}>{list}</ChartCard>;
      })}
    </div>
  );
}

/** One section in the new frame. Users and roles are native; the rest mount the existing section behind the same permission check. */
export function AdminSectionView({ slug }: { slug: string }) {
  const { can } = useV2Session();
  if (!isAdminSlug(slug)) return <EmptyState heading={t("Nothing at this address")} />;
  const section = ADMIN_SECTIONS.find((s) => s.slug === slug)!;
  if (!section.needs.some((n) => can(n))) return <Denied what={section.label} />;
  if (slug === "users") return <Users />;
  if (slug === "roles") return <Roles />;
  return <LegacyMount><AdminCanvas section={slug} /></LegacyMount>;
}
