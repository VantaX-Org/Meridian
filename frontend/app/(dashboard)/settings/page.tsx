"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AdminDoctorCard } from "@/components/aurora";
import { PageHeader } from "@/components/ui-core";
import { getDoctor } from "@/lib/api/admin-doctor";
import { useRole } from "@/hooks/use-role";
import { useNavGate } from "@/hooks/use-nav";
import { isItemVisible, SETTINGS_ITEMS } from "@/lib/nav";

/** Each entry carries the same permission and licence gate as its nav item
 *  (lib/nav.ts SETTINGS_ITEMS), so a role only sees pages it can use. */
const GROUPS: { title: string; items: { href: string; title: string; desc: string; perm?: string }[] }[] = [
  {
    title: "Checks",
    items: [
      { href: "/settings/rules", title: "Rules", desc: "Every check the analysis runs, its versions, reviews and suppressions." },
      { href: "/ai/rules", title: "Draft a rule with AI", desc: "Describe a check in words, dry-run it, save it for review.", perm: "manage_rules" },
      { href: "/settings/scoring", title: "Scoring and alerts", desc: "Dimension weights, cost per failing record, alert channels.", perm: "manage_settings" },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/settings/field-mapping", title: "Field mapping", desc: "Map source columns to SAP fields for each object." },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/settings/ai", title: "AI", desc: "Language model provider, model and connection test." },
      { href: "/settings/licence", title: "Licence", desc: "Tier, seats, renewal date and enabled modules." },
    ],
  },
];

function Doctor() {
  const { data, refetch } = useQuery({ queryKey: ["admin.doctor"], queryFn: getDoctor, refetchInterval: 30_000 });
  if (!data) return null;
  return <AdminDoctorCard items={data.items} lastChecked={new Date(data.last_checked).toLocaleTimeString()} onRefresh={() => refetch()} />;
}

export default function SettingsIndexPage() {
  const { can } = useRole();
  const gate = useNavGate();
  const visible = (href: string, perm?: string) => {
    if (perm && !can(perm)) return false;
    const item = SETTINGS_ITEMS.find((i) => i.href === href);
    return item ? isItemVisible(item, gate) : true;
  };
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => visible(i.href, i.perm)) })).filter((g) => g.items.length);

  return (
    <div className="ui-page">
      <PageHeader title="Settings" summary={
        <>
          How Meridian checks, scores and reports your SAP data.
          {can("manage_users") ? <> Users and roles are under <Link className="ui-link" href="/admin">Users and audit</Link>.</> : null}
        </>
      } />
      <div className="ui-columns">
        <div className="ui-stack">
          {groups.map((g) => (
            <section key={g.title} className="ui-index-group" aria-labelledby={`settings-${g.title}`}>
              <h2 id={`settings-${g.title}`} className="ui-index-group__title">{g.title}</h2>
              <ul className="ui-index">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href}>
                      <span className="ui-index__title">{i.title}</span>
                      <span className="ui-index__desc">{i.desc}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {can("manage_system") ? <div className="ui-stack"><Doctor /></div> : null}
      </div>
    </div>
  );
}
