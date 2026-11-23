import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

/**
 * Page header. Top to bottom: trail (under 64rem only, the section bar carries it above that), title with status and actions,
 * meta row (which data, which moment), stepper slot, tabs slot. `context` and `back` stay for older screens.
 */
export function PageHeader({ title, context, actions, back, crumbs, status, meta, stepper, tabs }: {
  title: string; context?: ReactNode; actions?: ReactNode; back?: { href: string; label: string };
  crumbs?: Crumb[]; status?: ReactNode; meta?: ReactNode[]; stepper?: ReactNode; tabs?: ReactNode;
}) {
  const facts = (meta ?? []).filter((m) => m !== null && m !== undefined && m !== false && m !== "").slice(0, 5);
  return (
    <header className="mx-head">
      {crumbs?.length ? <div className="mx-page-crumbs"><Breadcrumbs items={crumbs} label={t("Breadcrumb")} collapsedLabel={t("Hidden levels")} /></div> : null}
      <div className="mx-head-row">
        <div className="mx-head-t">
          {back ? <Link href={back.href} className="mx-back">{back.label}</Link> : null}
          <h1 className="mx-h1">{title}{status ? <span className="mx-head-status">{status}</span> : null}</h1>
          {context ? <p className="mx-muted">{context}</p> : null}
        </div>
        {actions ? <div className="mx-head-actions">{actions}</div> : null}
      </div>
      {facts.length ? <ul className="mx-head-meta">{facts.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
      {stepper ? <div className="mx-head-stepper">{stepper}</div> : null}
      {tabs ? <div className="mx-head-tabs">{tabs}</div> : null}
    </header>
  );
}
