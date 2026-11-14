"use client";

/**
 * Guided admin tasks under /more/admin/flow/[name]. They compose the StepFlow kit and the flows of feat/process-stepper
 * and mount the v2 screens untouched; Admin.tsx, ConnectCanvas and SourceDesign stay the full screens, linked from here.
 */
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLicenceManifest } from "@/lib/api/licence";
import { listRoles } from "@/lib/api/roles";
import { RulePromotion } from "@/design/v2/screens/RulePromotion";
import { useV2Href } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { EmptyState, Skeleton, StepFlow, type FlowStep } from "../kit";
import { ConnectSteps } from "../flows/ConnectSteps";
import { InviteSteps } from "../flows/InviteSteps";
import { LegacyMount } from "../shell/LegacyMount";

export const ADMIN_FLOWS = ["connect", "users", "rules"] as const;
export type AdminFlowName = (typeof ADMIN_FLOWS)[number];
export const isAdminFlow = (s: string | undefined): s is AdminFlowName => ADMIN_FLOWS.includes(s as AdminFlowName);

export const flowTitle = (n: AdminFlowName): string =>
  n === "connect" ? t("Connect a system") : n === "users" ? t("Add a user and role") : t("Promote a rule");

/** Cards for the admin page: one per task, each with the sentence that says what it does. */
export function FlowCards() {
  const href = useV2Href();
  const blurb: Record<AdminFlowName, string> = {
    connect: t("Test a logon, choose objects, then extract."),
    users: t("Invite someone with a role, then share the link."),
    rules: t("Dry-run generated rules and promote the ones that hold."),
  };
  return (
    <ul className="nx-more-grid" aria-label={t("Guided tasks")}>
      {ADMIN_FLOWS.map((n) => (
        <li key={n}><Link className="nx-more-card" href={href(`/more/admin/flow/${n}`)}><h2>{flowTitle(n)}</h2><p>{blurb[n]}</p></Link></li>
      ))}
    </ul>
  );
}

function UsersTask() {
  const q = useQuery({ queryKey: ["admin-flow-roles"], queryFn: listRoles });
  if (q.isPending) return <Skeleton lines={4} />;
  if (q.isError || !q.data.length) return <EmptyState heading={t("No roles could be read.")} />;
  return <InviteSteps roles={q.data.filter((r) => !r.legacy).map((r) => ({ key: r.key, label: r.name }))} />;
}

function ConnectTask() {
  const q = useQuery({ queryKey: ["admin-flow-licence"], queryFn: getLicenceManifest });
  if (q.isPending) return <Skeleton lines={4} />;
  return <ConnectSteps objects={q.data?.enabled_modules ?? []} />;
}

/** Pick, dry-run and promote all live in RulePromotion; the flow adds the review gate and the way on. */
export function RuleTask() {
  const href = useV2Href();
  const [reviewed, setReviewed] = useState(false);
  const steps: FlowStep[] = [
    { id: "review", label: t("Dry-run and review"), blocked: reviewed ? undefined : t("Confirm that you reviewed the impact."),
      body: <>
        <LegacyMount><RulePromotion /></LegacyMount>
        <label className="nx-field"><span><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> {t("I reviewed the impact of these rules.")}</span></label>
      </> },
    { id: "done", label: t("Done"), body: <p>{t("Promoted rules score the next run. Open the catalogue to see them.")} <Link className="nx-link" href={href("/more/rules")}>{t("Rules")}</Link></p> },
  ];
  return <StepFlow steps={steps} label={flowTitle("rules")} />;
}

export function AdminFlow({ name }: { name: AdminFlowName }) {
  const href = useV2Href();
  return (
    <div className="nx-more">
      <header className="nx-strip">
        <Link className="nx-link" href={href("/more/admin")}>{t("Administration")}</Link>
        <h1>{flowTitle(name)}</h1>
      </header>
      {name === "connect" ? <><ConnectTask /><p><Link className="nx-link" href={href("/more/systems")}>{t("Open all systems")}</Link></p></> : null}
      {name === "users" ? <><UsersTask /><p><Link className="nx-link" href={href("/more/admin/users")}>{t("Open all users")}</Link></p></> : null}
      {name === "rules" ? <RuleTask /> : null}
    </div>
  );
}
