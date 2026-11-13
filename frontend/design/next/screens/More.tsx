"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdminCanvas } from "@/design/v2/admin/Admin";
import { t } from "@/lib/v2/i18n";
import { useV2Href } from "@/lib/v2/hooks";
import { EmptyState, Tabs } from "../kit";
import { GROUPS, LINKS, SINGLES } from "../more/groups";
import { LegacyMount } from "../shell/LegacyMount";
import { AdminFlow, FlowCards, isAdminFlow } from "../admin/AdminFlows";
import "../shell/shell.css";
import "../more/more.css";

function Home() {
  const href = useV2Href();
  return (
    <div className="nx-more">
      <header className="nx-strip"><h1>{t("More")}</h1></header>
      <ul className="nx-more-grid">
        {GROUPS.map((g) => (
          <li key={g.id}>
            <Link className="nx-more-card" href={href(`/more/${g.id}`)}>
              <h2>{g.title()}</h2>
              <p>{g.blurb()}</p>
              <span className="nx-more-tabs">{g.tabs.map((x) => x.label()).join(", ")}</span>
            </Link>
          </li>
        ))}
        {Object.entries(SINGLES).filter(([k]) => !k.includes("/")).map(([k, s]) => (
          <li key={k}>
            <Link className="nx-more-card" href={href(`/more/${k}`)}><h2>{s.title()}</h2><p>{s.blurb()}</p></Link>
          </li>
        ))}
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link className="nx-more-card" href={href(l.href)}><h2>{l.title()}</h2><p>{l.blurb()}</p></Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Back() {
  const href = useV2Href();
  return <Link className="nx-link" href={href("/more")}>{t("More")}</Link>;
}

export function More({ slug }: { slug?: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const key = (slug ?? []).join("/");
  if (!key) return <Home />;

  const group = GROUPS.find((g) => g.id === slug?.[0] && slug.length === 1);
  if (group) {
    const tab = group.tabs.find((x) => x.id === sp.get("tab")) ?? group.tabs[0];
    return (
      <div className="nx-more">
        <header className="nx-strip">
          <Back />
          <h1>{group.title()}</h1>
          <Tabs items={group.tabs.map((x) => ({ id: x.id, label: x.label() }))} value={tab.id} onChange={(id) => router.replace(`${path}?tab=${id}`)} label={group.title()} idBase="nx-more" />
        </header>
        <div id={`nx-more-panel-${tab.id}`} role="tabpanel"><LegacyMount><tab.Screen /></LegacyMount></div>
      </div>
    );
  }

  if (slug?.[0] === "admin" && slug[1] === "flow" && slug.length === 3 && isAdminFlow(slug[2])) return <AdminFlow name={slug[2]} />;

  const adminSection = slug?.[0] === "admin" && slug.length === 2 ? slug[1] : null;
  const single = SINGLES[key];
  if (single || adminSection) {
    return (
      <div className="nx-more">
        <header className="nx-strip"><Back /><h1>{single ? single.title() : t("Administration")}</h1></header>
        {key === "admin" ? <FlowCards /> : null}
        <LegacyMount>{adminSection ? <AdminCanvas section={adminSection} /> : single ? <single.Screen /> : null}</LegacyMount>
      </div>
    );
  }
  return <EmptyState heading={t("Nothing at this address")} />;
}
