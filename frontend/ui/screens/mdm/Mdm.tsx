"use client";

import { useCrumbs } from "@/ui/screens/flow";
import { useQuery } from "@tanstack/react-query";
import { getMdmHealth } from "@/lib/api/v2/mdm-health";
import { useFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, StatTile, TrendArea, useAletheia, useAletheiaScope } from "@/ui/kit";
import { day, pct, useHref } from "./shared";

const LINKS: { path: string; title: () => string; body: () => string; own: boolean }[] = [
  { path: "/mdm/golden", own: true, title: () => t("Golden records"), body: () => t("The surviving record for each real-world thing, with its sources, history and write-back.") },
  { path: "/mdm/match", own: true, title: () => t("Match review"), body: () => t("Duplicate candidates, scores, decisions, merges and clusters.") },
  { path: "/mdm/match-rules", own: true, title: () => t("Match rules"), body: () => t("Which fields are compared, how much each counts, and what a change would do.") },
  { path: "/mdm/survivorship", own: true, title: () => t("Survivorship"), body: () => t("Which source wins each field, and the decisions Aletheia proposes.") },
  { path: "/mdm/glossary", own: false, title: () => t("Glossary"), body: () => t("Business terms and their definitions.") },
  { path: "/mdm/reference", own: false, title: () => t("Reference data"), body: () => t("Shared code lists and their values.") },
  { path: "/mdm/links", own: false, title: () => t("Record links"), body: () => t("Cross-system keys that point at the same record.") },
  { path: "/mdm/catalogue", own: false, title: () => t("Catalogue"), body: () => t("What data exists, where it lives and who owns it.") },
  { path: "/mdm/mining", own: false, title: () => t("Mining"), body: () => t("Patterns found in the data.") },
  { path: "/mdm/lineage", own: false, title: () => t("Lineage"), body: () => t("Where a value came from and where it goes.") },
  { path: "/mdm/issues", own: false, title: () => t("Issues"), body: () => t("Open master data problems.") },
  { path: "/mdm/processes", own: false, title: () => t("Processes"), body: () => t("The master data processes and their owners.") },
  { path: "/requests", own: false, title: () => t("Requests"), body: () => t("Change requests for master data.") },
];

export function Mdm() {
  const crumbs = useCrumbs();
  useInterfaceLang();
  const fx = useFixture();
  const href = useHref();
  const chat = useAletheia();
  const q = useQuery({ queryKey: ["v2", "mdm", "health", fx], queryFn: getMdmHealth, staleTime: 30_000, retry: false });
  const snap = q.data?.latest ?? null;
  const trend = (q.data?.trend ?? []).filter((s) => typeof s.mdm_health_score === "number");
  const points = trend.map((s) => ({ axis: s.snapshot_date.slice(5, 10), title: s.snapshot_date.slice(0, 10), value: s.mdm_health_score }));

  useAletheiaScope({
    key: "mdm",
    label: t("Asking about master data"),
    suggestions: [t("How healthy is master data?"), t("What should a steward do first?")],
    answer: () => snap
      ? {
          text: t("Master data health is {score} out of 100 with {backlog} items waiting for a steward. Coverage of golden records is {cov}.", { score: Math.round(snap.mdm_health_score), backlog: snap.backlog_count, cov: pct(snap.golden_record_coverage_pct) }),
          evidence: [t("Snapshot of {date}", { date: day(snap.snapshot_date) })],
          actions: [{ id: "match", label: t("Open match review"), href: href("/mdm/match") }],
        }
      : { text: t("There is no master data snapshot yet, so there is nothing to explain.") },
  });

  const header = (
    <PageHeader crumbs={crumbs("mdm")}
      title={t("Master data")}
      context={snap ? t("Snapshot of {date}", { date: day(snap.snapshot_date) }) : undefined}
      actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>}
    />
  );
  if (q.isLoading) return <>{header}<Skeleton lines={6} label={t("Loading master data health")} /></>;
  if (q.isError) return <>{header}<ErrorState heading={t("Master data health could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /></>;

  return (
    <>
      {header}
      <div className="mx-col">
        {snap ? (
          <dl className="mx-tiles">
            <StatTile label={t("Health score")} value={String(Math.round(snap.mdm_health_score))} bar={snap.mdm_health_score} />
            <StatTile label={t("Golden records")} value={snap.golden_record_count.toLocaleString()} />
            <StatTile label={t("Coverage")} value={pct(snap.golden_record_coverage_pct)} bar={snap.golden_record_coverage_pct * 100} />
            <StatTile label={t("Average match confidence")} value={pct(snap.avg_match_confidence)} bar={snap.avg_match_confidence * 100} />
            <StatTile label={t("Steward SLA met")} value={pct(snap.steward_sla_compliance_pct)} bar={snap.steward_sla_compliance_pct * 100} />
            <StatTile label={t("Source consistency")} value={pct(snap.source_consistency_pct)} bar={snap.source_consistency_pct * 100} />
            <StatTile label={t("Sync coverage")} value={pct(snap.sync_coverage_pct)} bar={snap.sync_coverage_pct * 100} />
            <StatTile label={t("Steward backlog")} value={snap.backlog_count.toLocaleString()} />
          </dl>
        ) : (
          <EmptyState heading={t("No master data snapshot yet")} body={t("A snapshot appears after the first master data run.")} />
        )}
        {snap ? (
          <Card title={t("Health over time")} sub={snap.ai_narrative ?? undefined}>
            <TrendArea points={points} label={t("Master data health score over time")} emptyLabel={t("Not enough snapshots for a trend yet")} />
            {snap.ai_risk_flags && snap.ai_risk_flags.length > 0 ? (
              <ul className="mx-muted">{snap.ai_risk_flags.map((f) => <li key={f}>{f}</li>)}</ul>
            ) : null}
          </Card>
        ) : null}
        <Card title={t("Work with master data")}>
          <div className="mx-tiles">
            {LINKS.map((l) => (
              <Button key={l.path} variant="secondary" href={href(l.path)}>{l.title()}</Button>
            ))}
          </div>
          <ul className="mx-muted">
            {LINKS.map((l) => <li key={l.path}><strong>{l.title()}</strong> {l.body()}</li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
