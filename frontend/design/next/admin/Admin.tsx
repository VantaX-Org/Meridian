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
import { useLicence, useUsers } from "@/lib/v2/admin-queries";
import { userStatus } from "@/lib/users";
import { EmptyViz, Ring, SegBar } from "../kit/viz/Viz";
import { Roles } from "./Roles";
import { Users } from "./Users";

/** The visual at the head of a card, from real data only: people by status, seats used, or the empty chart shape. */
function GroupViz({ group }: { group: string }) {
  const { can } = useV2Session();
  const users = useUsers({}, can("manage_users"));
  const lic = useLicence();
  if (group === t("People and access") && users.data) {
    const n = (s: string) => users.data!.users.filter((u) => userStatus(u) === s).length;
    return <SegBar label={group} parts={[{ label: t("Active"), value: n("active") }, { label: t("Invited"), value: n("invited") + n("invite_expired") }, { label: t("Locked"), value: n("locked") + n("suspended") }]} />;
  }
  const L = lic.data as { seats_used?: number; seats?: number | null } | undefined;
  if (group === t("Tenant") && L && typeof L.seats_used === "number" && L.seats) {
    return <Ring label={group} value={L.seats_used} max={L.seats} caption={t("{n} of {m} seats used", { n: L.seats_used, m: L.seats })} />;
  }
  return <EmptyViz line={t("No usage figures for this group yet.")} />;
}

/** Administration: five cards, one per group, each listing the sections this person may open. The one entry to admin. */
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
    <ul className="nx-cards" data-testid="admin-cards">
      {groups.map(([group, items]) => (
        <li key={group} className="nx-more-card">
          <GroupViz group={group} />
          <h2>{group}</h2>
          <ul>
            {items.map((s) => (
              <li key={s.slug}><Link className="nx-link" href={href(`/more/admin/${s.slug}`)}>{s.label}</Link><span className="nx-sub"> {s.lead}</span></li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
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
