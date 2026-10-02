"use client";

/**
 * Workbench → Golden records: the master records consolidated from every
 * source, their confidence and open issues, by domain. Each row opens the
 * record's page (fields, sources, history, promote, writeback).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Banner, Button, Chip, DataTable, EmptyState, KpiRail, Stack, Stat, Text, type AuroraColumnMeta, type ChipTone } from "@/components/aurora";
import { downloadCsv } from "@/components/meridian/actions";
import { useUrlState } from "@/hooks/use-url-state";
import { getMasterRecords } from "@/lib/api/master-records";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { MasterRecordStatus, MasterRecordSummary } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const STATUS_TONE: Partial<Record<MasterRecordStatus, ChipTone>> = { golden: "success", pending_review: "warning", candidate: "info" };
const pct = (c: number) => Math.round(c * 100);

export function GoldenRecordsSurface() {
  const router = useRouter();
  const [domain, setDomain] = useUrlState("domain", "all");
  const q = useQuery({ queryKey: ["master-records.list", { domain }], queryFn: () => getMasterRecords({ per_page: 100, domain: domain === "all" ? undefined : domain }) });
  const records = useMemo(() => q.data?.records ?? [], [q.data]);
  const total = q.data?.total ?? records.length;
  const domains = useMemo(() => { const c: Record<string, number> = {}; for (const r of records) c[r.domain] = (c[r.domain] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); }, [records]);
  const golden = records.filter((r) => r.status === "golden").length;
  const pending = records.filter((r) => r.status === "pending_review").length;
  const issues = records.reduce((a, r) => a + r.pending_issues, 0);
  const mean = records.length ? Math.round(records.reduce((a, r) => a + r.overall_confidence, 0) / records.length * 100) : null;

  const columns = useMemo<ColumnDef<MasterRecordSummary, unknown>[]>(() => [
    { id: "key", header: "SAP key", meta: meta({ sticky: "start", width: 200 }), cell: ({ row }) => (
      <span><strong className="aurora-number">{row.original.sap_object_key}</strong><Text variant="text-micro" tone="muted" as="div" className="aurora-number">{row.original.id.slice(0, 8)}</Text></span>) },
    { id: "domain", header: "Domain", meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "status", header: "Status", meta: meta({ width: 140 }), cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status] ?? "neutral"}>{row.original.status.replace(/_/g, " ")}</Chip> },
    { id: "sources", header: "Sources", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => row.original.source_count },
    { id: "conf", header: "Confidence", meta: meta({ width: 110, align: "end", numeric: true }), cell: ({ row }) => `${pct(row.original.overall_confidence)}%` },
    { id: "issues", header: "Open issues", meta: meta({ width: 110, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.pending_issues ? <Chip tone="danger">{row.original.pending_issues}</Chip> : "—") },
    { id: "updated", header: "Updated", meta: meta({ width: 110 }), cell: ({ row }) => relativeTime(row.original.updated_at) },
  ], []);

  const exportCsv = () => downloadCsv("meridian-golden-records.csv", records.map((r) => ({
    id: r.id, domain: r.domain, sap_key: r.sap_object_key, sources: r.source_count, confidence: `${pct(r.overall_confidence)}%`, issues: r.pending_issues, status: r.status, updated_at: r.updated_at,
  })));

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Master records" value={total} />
        <Stat label="Golden" value={golden} tone={golden ? "success" : "neutral"} />
        <Stat label="Pending review" value={pending} tone={pending ? "warning" : "neutral"} />
        <Stat label="Open issues" value={issues} tone={issues ? "danger" : "neutral"} />
        <Stat label="Mean confidence" value={mean ?? "—"} unit={mean === null ? undefined : "%"} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        <Chip selected={domain === "all"} onClick={() => setDomain("all")}>All · {total}</Chip>
        {domains.map(([d, n]) => <Chip key={d} selected={domain === d} onClick={() => setDomain(d)}>{formatModuleName(d)} · {n}</Chip>)}
        <span style={{ flex: 1 }} />
        <Link href="/dedup" className="aurora-link">Duplicates →</Link>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!records.length}>Export CSV</Button>
      </Stack>
      {q.isLoading ? <Text tone="muted">Reading master records.</Text>
        : q.error ? <Banner tone="danger" title="Master records could not be read">{(q.error as Error).message}</Banner>
        : records.length ? <DataTable columns={columns} data={records} getRowId={(r) => r.id} onRowActivate={(r) => router.push(`/golden-records/${r.id}`)} ariaLabel="Master records" maxHeight="60vh" />
        : <EmptyState title="No master records yet." body="Golden records are consolidated from the sources after duplicates are merged; approve a merge in Duplicates to create the first." />}
    </Stack>
  );
}
