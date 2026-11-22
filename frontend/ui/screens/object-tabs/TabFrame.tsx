"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, PageHeader, useAletheia, useAletheiaScope, type AletheiaAnswer } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";

export type Tab = "records" | "record" | "trend" | "runs" | "fixes" | "rules" | "golden" | "glossary" | "lineage" | "profile" | "readiness" | "processes" | "design";

/** The sub-screens of an object, in the order the strip shows them. `path` is relative to the object's own route. */
export const TABS: { id: Tab; path: string; label: () => string }[] = [
  { id: "records", path: "records", label: () => t("Records") },
  { id: "trend", path: "trend", label: () => t("Trend") },
  { id: "runs", path: "runs", label: () => t("Runs") },
  { id: "fixes", path: "fixes", label: () => t("Fixes") },
  { id: "rules", path: "rules", label: () => t("Rules") },
  { id: "golden", path: "golden", label: () => t("Golden records") },
  { id: "glossary", path: "glossary", label: () => t("Glossary") },
  { id: "lineage", path: "lineage", label: () => t("Lineage") },
  { id: "profile", path: "profile", label: () => t("Profile") },
  { id: "readiness", path: "readiness", label: () => t("Readiness") },
  { id: "processes", path: "processes", label: () => t("Processes") },
];

export const objectPath = (system: string, module: string, sub = "") => `/o/${system}/${module.replace(/_/g, "-")}${sub ? `/${sub}` : ""}`;

/** Registers the shell chat for this sub-screen, scoped to the object. */
export function useTabChat(system: string, module: string, tab: Tab, label: string, suggestions: string[], answer: (prompt: string) => AletheiaAnswer) {
  useAletheiaScope({ key: `${system}/${module}/${tab}`, label: t("Asking about {object}", { object: label }), suggestions, answer });
}

const VISIBLE: Tab[] = ["records", "rules", "fixes", "trend"];

/** Overview plus four sub-screens in the strip; the other seven sit under More, still links in the page. */
export function ObjectTabNav({ o, system, module, active }: { o: ObjectRun; system: string; module: string; active: Tab | "overview" }) {
  useInterfaceLang();
  const fx = useFixture();
  const link = (sub: string) => withFixture(o.hrefWith(objectPath(system, module, sub)), fx);
  const shown = [{ id: "overview" as const, path: "", label: () => t("Overview") }, ...VISIBLE.map((id) => TABS.find((x) => x.id === id)!)];
  const rest = TABS.filter((x) => !VISIBLE.includes(x.id));
  const inMore = rest.some((x) => x.id === active);
  return (
    <nav className="mx-links mx-objtabs" aria-label={t("Object screens")}>
      {shown.map((x) => (
        <Link key={x.id} className="mx-btn" data-variant={active === x.id ? "primary" : "ghost"} href={link(x.path)} aria-current={active === x.id ? "page" : undefined}>{x.label()}</Link>
      ))}
      <details className="mx-objmore" data-active={inMore ? "" : undefined}>
        <summary className="mx-btn" data-variant={inMore ? "primary" : "ghost"}>{t("More")}</summary>
        <div className="mx-menu">
          {rest.map((x) => (
            <Link key={x.id} className="mx-menuitem" href={link(x.path)} aria-current={active === x.id ? "page" : undefined}>{x.label()}</Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

/** Header, the strip of sub-screens, and the Ask Aletheia button shared by every object sub-screen. */
export function TabFrame({ o, system, module, tab, title, actions, children }: {
  o: ObjectRun; system: string; module: string; tab: Tab; title: string; actions?: ReactNode; children: ReactNode;
}) {
  useInterfaceLang();
  const chat = useAletheia();
  const active = tab === "record" ? "records" : tab === "design" ? "processes" : tab;
  return (
    <>
      <PageHeader
        title={title}
        context={<>{o.label}{", "}{o.systemName}</>}
        actions={<>
          {actions}
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <ObjectTabNav o={o} system={system} module={module} active={active} />
      {children}
    </>
  );
}
