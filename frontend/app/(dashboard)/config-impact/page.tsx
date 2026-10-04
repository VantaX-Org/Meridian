"use client";

/**
 * Config impact: which SAP features the latest complete version's findings
 * block or degrade, with the transactions they stop and the records behind
 * them. Status colour is the feature's blocking state only.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, DataTable, EmptyState, FilterBar, Metric, MetricStrip, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getVersions } from "@/lib/api/versions";
import type { ConfigImpactResult, Version } from "@/types/api";

function isCompleteVersion(v: Version): boolean {
  return (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;
}

const STATE: Record<ConfigImpactResult["status"], { status: Status; label: string }> = {
  blocked: { status: "critical", label: "Blocked" },
  degraded: { status: "medium", label: "Degraded" },
  ok: { status: "ok", label: "Unaffected" },
};
const ORDER = { blocked: 0, degraded: 1, ok: 2 } as const;

const meta = (m: AuroraColumnMeta) => m;

const columns: ColumnDef<ConfigImpactResult, unknown>[] = [
  { id: "feature", header: "Feature", meta: meta({ sticky: "start", minWidth: 220 }), accessorFn: (r) => r.feature,
    cell: ({ row }) => {
      const t = row.original.blocked_transactions;
      return (
        <span className="ui-cell-stack">
          <span className="ui-cell-stack__main">{row.original.feature}</span>
          {t.length ? <span className="ui-cell-stack__sub"><Mono>{t.slice(0, 4).join(", ")}</Mono>{t.length > 4 ? ` and ${t.length - 4} more` : ""}</span> : null}
        </span>
      );
    } },
  { id: "system", header: "System", meta: meta({ width: 120 }), accessorFn: (r) => r.system },
  { id: "status", header: "State", meta: meta({ width: 120 }), accessorFn: (r) => ORDER[r.status],
    cell: ({ row }) => <StatusBadge status={STATE[row.original.status].status}>{STATE[row.original.status].label}</StatusBadge> },
  { id: "blocking", header: "Blocking findings", meta: meta({ width: 140, numeric: true }), accessorFn: (r) => r.blocking_findings.length },
  { id: "records", header: "Records", meta: meta({ width: 120, numeric: true }), accessorFn: (r) => r.total_affected_records,
    cell: ({ row }) => row.original.total_affected_records.toLocaleString() },
  { id: "cost", header: "Opportunity cost", meta: meta({ minWidth: 260 }), accessorFn: (r) => r.opportunity_cost_summary },
];

export default function ConfigImpactPage() {
  const [q, setQ] = useState("");
  const versionsQ = useQuery({ queryKey: ["versions.list", { limit: 10 }], queryFn: () => getVersions({ limit: 10 }) });
  const latest = useMemo(() => versionsQ.data?.versions.find(isCompleteVersion), [versionsQ.data]);
  const impactQ = useQuery({
    queryKey: ["config-impact", latest?.id],
    queryFn: () => getConfigImpact(latest!.id),
    enabled: !!latest,
  });

  const results = useMemo(
    () => [...(impactQ.data?.results ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.total_affected_records - a.total_affected_records),
    [impactQ.data],
  );
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? results.filter((r) => [r.feature, r.system, ...r.blocked_transactions].some((v) => v.toLowerCase().includes(s))) : results;
  }, [results, q]);

  const header = (summary?: string) => <PageHeader title="Config impact" summary={summary} />;

  if (versionsQ.isLoading || (latest && impactQ.isLoading)) {
    return <div className="ui-page">{header()}<TableSkeleton rows={8} label="Loading config impact" /></div>;
  }
  const error = versionsQ.error ?? impactQ.error;
  if (error) {
    return (
      <div className="ui-page">
        {header()}
        <Banner tone="danger" title="Config impact could not be read">{(error as Error).message}</Banner>
      </div>
    );
  }
  if (!latest) {
    return (
      <div className="ui-page">
        {header()}
        <EmptyState action={<Link className="ui-link" href="/sync">Open sync</Link>}>
          Config impact is assessed against a completed analysis. Sync a system and run an analysis to see which features its findings block.
        </EmptyState>
      </div>
    );
  }

  const s = impactQ.data?.summary;
  return (
    <div className="ui-page">
      {header(`${(s?.total_features_assessed ?? results.length).toLocaleString()} features assessed against ${latest.label ?? "the latest complete version"}.`)}

      <MetricStrip label="Config impact figures">
        <Metric label="Assessed" value={s?.total_features_assessed ?? results.length} />
        <Metric label="Blocked" value={s?.features_blocked ?? 0} tone={s?.features_blocked ? "danger" : "default"} />
        <Metric label="Degraded" value={s?.features_degraded ?? 0} tone={s?.features_degraded ? "warning" : "default"} />
        <Metric label="Unaffected" value={s?.features_ok ?? 0} />
      </MetricStrip>

      <FilterBar search={{ value: q, onChange: setQ, placeholder: "Search feature, system or transaction" }} />
      <SectionCard title="Features" meta={`${visible.length.toLocaleString()} shown, blocked first`} flush>
        <div className="ui-table-stacked"><DataTable columns={columns} data={visible} getRowId={(r) => `${r.system}:${r.feature}`} ariaLabel="Config impact by feature" maxHeight="65vh"
                   empty={<EmptyState>{results.length ? "No features match this search." : "No features were assessed for this version."}</EmptyState>} /></div>
      </SectionCard>
    </div>
  );
}
