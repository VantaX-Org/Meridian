"use client";

/**
 * Golden records: the master records consolidated from every source, with
 * their confidence and open issues, by domain. Each row opens the record's
 * page (fields, sources, history, promote, writeback).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { downloadCsv } from "@/components/meridian/actions";
import {
  Banner, Button, Chip, DataTable, EmptyState, FilterBar, KeyValue, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, Tally,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useUrlState } from "@/hooks/use-url-state";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getMasterRecords } from "@/lib/api/master-records";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { MasterRecordStatus, MasterRecordSummary } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const STATUS: Partial<Record<MasterRecordStatus, { badge: Status; label: string }>> = {
  golden: { badge: "ok", label: "Golden" },
  pending_review: { badge: "medium", label: "Pending review" },
  candidate: { badge: "idle", label: "Candidate" },
};
const statusOf = (s: MasterRecordStatus) => STATUS[s] ?? { badge: "idle" as Status, label: s.replace(/_/g, " ") };
const pct = (c: number) => Math.round(c * 100);

const columns: ColumnDef<MasterRecordSummary, unknown>[] = [
  { id: "key", header: "SAP key", meta: meta({ sticky: "start", width: 200 }), cell: ({ row }) => <Mono>{row.original.sap_object_key}</Mono> },
  { id: "domain", header: "Domain", meta: meta({ width: 180 }), cell: ({ row }) => formatModuleName(row.original.domain) },
  { id: "status", header: "Status", meta: meta({ width: 150 }), cell: ({ row }) => { const s = statusOf(row.original.status); return <StatusBadge status={s.badge}>{s.label}</StatusBadge>; } },
  { id: "sources", header: "Sources", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => row.original.source_count },
  { id: "conf", header: "Confidence", meta: meta({ width: 110, align: "end", numeric: true }), cell: ({ row }) => `${pct(row.original.overall_confidence)}%` },
  { id: "issues", header: "Open issues", meta: meta({ width: 110, align: "end", numeric: true }), cell: ({ row }) => row.original.pending_issues || "" },
  { id: "updated", header: "Updated", meta: meta({ width: 120 }), cell: ({ row }) => relativeTime(row.original.updated_at) },
];

export function GoldenRecordsSurface() {
  const router = useRouter();
  const [domain, setDomain] = useUrlState("domain", "all");
  const q = useQuery({ queryKey: ["master-records.list", { domain }], queryFn: () => getMasterRecords({ per_page: 100, domain: domain === "all" ? undefined : domain }) });
  const mdm = useQuery({ queryKey: ["mdm-metrics"], queryFn: getMdmDashboard, retry: false, meta: { ignoreError: true } });
  const health = mdm.data?.latest ?? null;
  const records = useMemo(() => q.data?.records ?? [], [q.data]);
  const total = q.data?.total ?? records.length;
  const domains = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of records) c[r.domain] = (c[r.domain] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [records]);
  const golden = records.filter((r) => r.status === "golden").length;
  const pending = records.filter((r) => r.status === "pending_review").length;
  const issues = records.reduce((a, r) => a + r.pending_issues, 0);

  const exportCsv = () => downloadCsv("meridian-golden-records.csv", records.map((r) => ({
    id: r.id, domain: r.domain, sap_key: r.sap_object_key, sources: r.source_count, confidence: `${pct(r.overall_confidence)}%`, issues: r.pending_issues, status: r.status, updated_at: r.updated_at,
  })));

  return (
    <div className="ui-page">
      <PageHeader
        title="Golden records"
        summary="One master record per real-world entity, consolidated from every source after duplicates are merged."
        actions={
          <>
            <Link href="/dedup" className="ui-link">Review duplicates</Link>
            <Button variant="secondary" onClick={exportCsv} disabled={!records.length}>Export CSV</Button>
          </>
        }
      />
      <Tally level={2} label="Master records" figures={[
        { label: "MDM health", value: health ? Math.round(health.mdm_health_score) : mdm.isError ? "None" : null, unit: health ? "of 100" : undefined, loading: mdm.isLoading,
          tone: health && health.mdm_health_score < 60 ? "danger" : undefined,
          verdict: health ? `${Math.round(health.golden_record_coverage_pct)}% coverage, ${health.backlog_count} in the steward backlog.` : "No snapshot yet.", href: "/golden-records#mdm-health" },
        { label: "Master records", value: q.isLoading ? null : total, loading: q.isLoading, verdict: `${golden} golden.`, href: "/golden-records" },
        { label: "Pending review", value: q.isLoading ? null : pending, loading: q.isLoading, tone: pending ? "warning" : undefined, verdict: pending ? "Waiting for a steward." : "None.", href: "/golden-records" },
        { label: "Open issues", value: q.isLoading ? null : issues, loading: q.isLoading, tone: issues ? "danger" : undefined, verdict: issues ? "Failing checks on these records." : "None.", href: "/analyse?tab=records&status=open" },
      ]} />
      {health ? (
        <SectionCard title="MDM health" meta={health.snapshot_date}>
          <span id="mdm-health" />
          <KeyValue rows={[
            { k: "Golden record coverage", v: `${Math.round(health.golden_record_coverage_pct)}%` },
            { k: "Mean match confidence", v: `${Math.round(health.avg_match_confidence * (health.avg_match_confidence <= 1 ? 100 : 1))}%` },
            { k: "Steward SLA met", v: `${Math.round(health.steward_sla_compliance_pct)}%` },
            { k: "Source consistency", v: `${Math.round(health.source_consistency_pct)}%` },
            { k: "Sync coverage", v: `${Math.round(health.sync_coverage_pct)}%` },
            ...(health.ai_narrative ? [{ k: "Summary", v: health.ai_narrative }] : []),
          ]} />
        </SectionCard>
      ) : null}
      <FilterBar>
        <Chip selected={domain === "all"} onClick={() => setDomain("all")}>All domains<span className="ui-chip-count">{total}</span></Chip>
        {domains.map(([d, n]) => (
          <Chip key={d} selected={domain === d} onClick={() => setDomain(d)}>{formatModuleName(d)}<span className="ui-chip-count">{n}</span></Chip>
        ))}
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={8} label="Loading master records" />
        : q.error ? <Banner tone="danger" title="Master records could not be read">{(q.error as Error).message}</Banner>
        : records.length ? (
          <DataTable columns={columns} data={records} getRowId={(r) => r.id} onRowActivate={(r) => router.push(`/golden-records/${r.id}`)}
            ariaLabel="Master records" maxHeight="60vh" />
        ) : (
          <EmptyState action={<Link href="/dedup" className="ui-link">Review duplicates</Link>}>
            No master records yet. Approving a merge in duplicates creates the first one.
          </EmptyState>
        )}
    </div>
  );
}
