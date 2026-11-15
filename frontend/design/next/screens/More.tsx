"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { t } from "@/lib/v2/i18n";
import { useV2Href } from "@/lib/v2/hooks";
import { EmptyState, Tabs } from "../kit";
import { GROUPS, SINGLES, TILES } from "../more/groups";
import { MoreCards } from "../more/cards";
import { Rules } from "../more/Rules";
import { RuleCanvas } from "@/design/v2/screens/Rule";
import { Reports } from "../more/Reports";
import { Systems } from "../more/Systems";
import { SystemPage } from "../more/SystemPage";
import { People } from "../more/People";
import { AdminHome, AdminSectionView } from "../admin/Admin";
import { LegacyMount } from "../shell/LegacyMount";
import { AdminFlow, FlowCards, isAdminFlow } from "../admin/AdminFlows";
import "../shell/shell.css";
import "../more/more.css";

const NATIVE = new Set(["rules", "reports", "systems", "people", "admin"]);

/** More opens on chart-led cards for the native screens, then every other screen as a plain link with its line. */
function Home() {
  const href = useV2Href();
  return (
    <div className="nx-more">
      <header className="nx-strip"><h1>{t("More")}</h1></header>
      <MoreCards />
      <ul className="nx-more-links" data-testid="more-tiles">
        {TILES.filter((x) => !NATIVE.has(x.id)).map((x) => (
          <li key={x.id}>
            <Link className="nx-link" href={href(x.href)}>{x.title()}</Link>
            <p>{x.blurb()}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Back({ to = "/more", label }: { to?: string; label?: string }) {
  const href = useV2Href();
  return <Link className="nx-link" href={href(to)}>{label ?? t("More")}</Link>;
}

/** A screen mounted inside the strip often brings its own h1; the strip title then steps down so a page keeps one h1. */
function useOwnH1() {
  const ref = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOwn(!!el.querySelector("h1"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  return { ref, own };
}

function StripTitle({ own, title }: { own: boolean; title: string }) {
  return own ? <p className="nx-strip-title">{title}</p> : <h1>{title}</h1>;
}

function Frame({ title, back, children }: { title: string; back?: { to: string; label: string }; children: React.ReactNode }) {
  const { ref, own } = useOwnH1();
  return (
    <div className="nx-more">
      <header className="nx-strip"><Back to={back?.to} label={back?.label} /><StripTitle own={own} title={title} /></header>
      <div ref={ref} className="nx-more-body">{children}</div>
    </div>
  );
}

export function More({ slug }: { slug?: string[] }) {
  const key = (slug ?? []).join("/");
  const [a, b] = slug ?? [];
  if (!key) return <Home />;

  if (a === "rules" && slug!.length <= 2) {
    return b
      ? <Frame title={t("Rule")} back={{ to: "/more/rules", label: t("Rules") }}><LegacyMount><RuleCanvas id={decodeURIComponent(b)} /></LegacyMount></Frame>
      : <Frame title={t("Rules")}><Rules /></Frame>;
  }
  if (key === "reports") return <Frame title={t("Reports")}><Reports /></Frame>;
  if (key === "people") return <Frame title={t("People")}><People /></Frame>;
  if (a === "systems" && b !== "config" && slug!.length <= 2) {
    return b
      ? <Frame title={t("Systems")} back={{ to: "/more/systems", label: t("Systems") }}><SystemPage id={b} /></Frame>
      : <Frame title={t("Systems")}><Systems /></Frame>;
  }
  if (a === "admin" && b === "flow" && slug!.length === 3 && isAdminFlow(slug![2])) return <AdminFlow name={slug![2]} />;
  if (a === "admin" && slug!.length <= 2) {
    return b
      ? <Frame title={t("Administration")} back={{ to: "/more/admin", label: t("Administration") }}><AdminSectionView slug={b} /></Frame>
      : <Frame title={t("Administration")}><FlowCards /><AdminHome /></Frame>;
  }

  const group = GROUPS.find((g) => g.id === a && slug!.length === 1);
  if (group) return <GroupView group={group} />;

  const single = SINGLES[key];
  if (single) return <Frame title={single.title()}><LegacyMount><single.Screen /></LegacyMount></Frame>;
  return <EmptyState heading={t("Nothing at this address")} />;
}

function GroupView({ group }: { group: (typeof GROUPS)[number] }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const { ref, own } = useOwnH1();
  {
    const tab = group.tabs.find((x) => x.id === sp.get("tab")) ?? group.tabs[0];
    return (
      <div className="nx-more">
        <header className="nx-strip">
          <Back />
          <StripTitle own={own} title={group.title()} />
          <Tabs items={group.tabs.map((x) => ({ id: x.id, label: x.label() }))} value={tab.id} onChange={(id) => router.replace(`${path}?tab=${id}`)} label={group.title()} idBase="nx-more" />
        </header>
        <div ref={ref} id={`nx-more-panel-${tab.id}`} role="tabpanel"><LegacyMount><tab.Screen /></LegacyMount></div>
      </div>
    );
  }
}
