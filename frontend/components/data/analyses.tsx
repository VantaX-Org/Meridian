"use client";

/**
 * Analyses: every analysed version, two of them compared object by
 * object (score, dimensions, checks that started or stopped failing) and
 * record by record (new, resolved, persisting failures), the DQS trend, and
 * the baseline pin. Pair, object and system live in the URL.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { LineChart, Select } from "@/components/aurora";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FilterBar, Mono, PageHeader,
  SectionCard, StatusBadge, TableSkeleton, Tally, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { compareRecordKeys, compareRecords, compareVersions, getVersions, pinBaseline } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { DQSSummary, Version } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;

type Display = "complete" | "failed" | "running" | "scheduled";
function displayStatus(s: Version["status"]): Display {
  if (s === "complete" || s === "agents_complete" || s === "ai_enriched") return "complete";
  if (s === "failed" || s === "agents_failed") return "failed";
  if (s === "running" || s === "agents_running" || s === "ai_enriching" || s === "agents_enqueued") return "running";
  return "scheduled";
}
const STATUS_BADGE: Record<Display, { badge: Status; label: string }> = {
  complete: { badge: "ok", label: "Complete" }, failed: { badge: "failed", label: "Failed" },
  running: { badge: "running", label: "Running" }, scheduled: { badge: "idle", label: "Scheduled" },
};
const VersionStatus = ({ v }: { v: Version }) => {
  const s = STATUS_BADGE[displayStatus(v.status)];
  return <StatusBadge status={s.badge}>{s.label}</StatusBadge>;
};
const versionName = (v: Version) => v.label ?? v.metadata?.file_name ?? v.id.slice(0, 8);
const isComplete = (v: Version) => displayStatus(v.status) === "complete" && !!v.dqs_summary;
const scoped = (s: Record<string, DQSSummary> | null, object?: string) => !s ? null : object ? (s[object] ? { [object]: s[object] } : {}) : s;
function averageDqs(s: Record<string, DQSSummary> | null): number | null {
  const scores = Object.values(s ?? {}).map((m) => m.composite_score);
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
}
const sumCounts = (s: Record<string, DQSSummary> | null, key: "critical_count" | "high_count" | "total_checks") =>
  Object.values(s ?? {}).reduce((a, m) => a + m[key], 0);
const signed = (n: number | null, digits = 1) => (n === null ? "" : n === 0 ? "0" : `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`);
function errorText(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : (e as Error)?.message || "Comparison failed";
}
const findingsHref = (p: Record<string, string>) => `/findings?${new URLSearchParams(p)}`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AnalysesSurface() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { can } = useRole();
  const systemId = search.get("system_id") ?? undefined;
  const object = search.get("module") ?? "";
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [router, pathname, search]);

  const list = useQuery({ queryKey: ["versions.list", { limit: 100, system_id: systemId }], queryFn: () => getVersions({ limit: 100, system_id: systemId }) });
  const versions = useMemo(() => list.data?.versions ?? [], [list.data]);
  const completed = useMemo(() => versions.filter(isComplete), [versions]);

  // ticked rows live in state; Compare writes them to ?compare=v1,v2, which opens the drawer
  const compareParam = search.get("compare");
  const [picked, setPicked] = useState<string[]>(() => (compareParam ? compareParam.split(",").slice(0, 2) : []));
  const byAge = (ids: string[]) => ids.map((x) => versions.find((v) => v.id === x)).filter((v): v is Version => !!v)
    .sort((a, b) => a.run_at.localeCompare(b.run_at)).map((v) => v.id);
  const pair = useMemo<string[]>(() => (compareParam ? byAge(compareParam.split(",").slice(0, 2)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compareParam, versions]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? [p[1], id] : [...p, id]));
  const older = versions.find((v) => v.id === pair[0]);
  const newer = versions.find((v) => v.id === pair[1]);

  const cmp = useQuery({
    queryKey: ["versions.compare", pair[0], pair[1], object], enabled: pair.length === 2 && !!older && !!newer, retry: false,
    queryFn: () => compareVersions(pair[0], pair[1], object || undefined),
  });
  const objects = useMemo(() => Array.from(new Set([...Object.keys(older?.dqs_summary ?? {}), ...Object.keys(newer?.dqs_summary ?? {}), ...(object ? [object] : [])])).sort(), [older, newer, object]);
  const trend = useMemo(() => completed.slice(0, 20).reverse().map((v) => ({ run: relativeTime(v.run_at), id: v.id, dqs: averageDqs(scoped(v.dqs_summary, object || undefined)) ?? 0 })), [completed, object]);
  const baseline = versions.find((v) => v.metadata?.baseline);
  const latestDqs = completed[0] ? averageDqs(scoped(completed[0].dqs_summary, object || undefined)) : null;
  const baselineDqs = baseline ? averageDqs(scoped(baseline.dqs_summary, object || undefined)) : null;
  const sinceBaseline = latestDqs !== null && baselineDqs !== null && baseline?.id !== completed[0]?.id ? Math.round((latestDqs - baselineDqs) * 10) / 10 : null;

  const columns = useMemo<ColumnDef<Version, unknown>[]>(() => [
    { id: "pick", header: "", meta: meta({ width: 44, align: "center" }), cell: ({ row }) => (
      <input type="checkbox" aria-label={`Compare ${versionName(row.original)}`} checked={picked.includes(row.original.id)} onChange={() => toggle(row.original.id)} onClick={(e) => e.stopPropagation()} />) },
    { id: "when", header: "Version", meta: meta({ sticky: "start", width: 240 }), cell: ({ row }) => (
      <div className="ui-cell-stack">
        <Link href={`/data/runs/${row.original.id}?tab=summary`} className="ui-cell-stack__main ui-link" onClick={(e) => e.stopPropagation()}>{versionName(row.original)}</Link>
        <span className="ui-cell-stack__sub">
          <span>{relativeTime(row.original.run_at)}</span>
          <Mono>{row.original.id.slice(0, 8)}</Mono>
          {row.original.metadata?.baseline ? <span>Baseline</span> : null}
        </span>
      </div>) },
    { id: "status", header: "Status", meta: meta({ width: 120 }), cell: ({ row }) => <VersionStatus v={row.original} /> },
    { id: "dqs", header: "Score", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => { const d = averageDqs(scoped(row.original.dqs_summary, object || undefined)); return d === null ? "" : d.toFixed(1); } },
    { id: "crit", header: "Critical", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => sumCounts(row.original.dqs_summary, "critical_count") },
    { id: "high", header: "High", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => sumCounts(row.original.dqs_summary, "high_count") },
    { id: "checks", header: "Checks", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => sumCounts(row.original.dqs_summary, "total_checks") },
    { id: "objects", header: "Objects", meta: meta({ minWidth: 200 }), cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(", ") },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [picked, object, versions]);

  return (
    <div className="ui-page">
      <PageHeader
        title="Analyses"
        summary="Tick two runs and compare them. The older one is always on the left; the pin makes it the baseline later runs are measured against."
        actions={<Button disabled={picked.length !== 2} onClick={() => setParams({ compare: byAge(picked).join(",") })}>Compare</Button>} />
      <Tally level={2} label="Analysis runs" figures={[
        { label: "Runs", value: versions.length, href: "/analyse?tab=analyses", loading: list.isLoading, verdict: `${completed.length} analysed.` },
        { label: "Latest score", value: latestDqs, href: completed[0] ? `/data/runs/${completed[0].id}` : "/analyse?tab=analyses", loading: list.isLoading, unit: latestDqs === null ? undefined : "of 100", verdict: completed[0] ? versionName(completed[0]) : "Nothing analysed yet." },
        { label: "Baseline score", value: baselineDqs ?? "None", href: baseline ? `/data/runs/${baseline.id}` : "/analyse?tab=analyses", loading: list.isLoading, verdict: baseline ? versionName(baseline) : "Pin a run as the baseline from a comparison." },
        { label: "Change since baseline", value: sinceBaseline === null ? "None" : signed(sinceBaseline), href: "/analyse?tab=analyses", loading: list.isLoading,
          tone: sinceBaseline !== null && sinceBaseline < 0 ? "danger" : undefined, verdict: sinceBaseline === null ? "Needs a baseline and a later analysed run." : "Latest score minus baseline score." },
      ]} />
      <FilterBar onClear={object || systemId ? () => setParams({ module: null, system_id: null }) : undefined}>
        <Select aria-label="Object" placeholder="All objects" value={object} options={objects.map((o) => ({ value: o, label: formatModuleName(o) }))} onValueChange={(v) => setParams({ module: v || null })} />
        {systemId ? <Chip selected onDismiss={() => setParams({ system_id: null })}>System <Mono>{systemId.slice(0, 8)}</Mono></Chip> : null}
      </FilterBar>

      {trend.length >= 2 ? (
        <SectionCard title="Score trend" meta={`Last ${trend.length} analysed runs${object ? `, ${formatModuleName(object)}` : ""}`}>
          <LineChart data={trend} xKey="run" series={[{ key: "dqs", label: "Score" }]} height={180} ariaLabel="Score trend" yFormatter={(v) => v.toFixed(0)} onPointClick={(i) => router.push(`/data/runs/${trend[i].id}?tab=summary`)} />
        </SectionCard>
      ) : null}

      <SectionCard title="Run history" meta={versions.length || undefined} flush>
        {list.isLoading ? <TableSkeleton rows={6} label="Loading versions" /> : versions.length ? (
          <DataTable columns={columns} data={versions} getRowId={(v) => v.id} onRowActivate={(v) => router.push(`/data/runs/${v.id}?tab=summary`)} ariaLabel="Run history" maxHeight="56vh" />
        ) : <EmptyState action={<Link href="/data?tab=import" className="ui-link">Import a file</Link>}>No runs yet. Import a file or download objects from a connected system to create the first one.</EmptyState>}
      </SectionCard>

      <DetailDrawer open={pair.length === 2} onClose={() => setParams({ compare: null })} ariaLabel="Compare runs"
        header={<div className="ui-drawer-head"><h2 className="ui-drawer-head__title">Compare runs</h2></div>}>
        {older && newer ? (
          <div className="ui-stack">
            <PairSummary older={older} newer={newer} object={object} />
            {cmp.isError ? <Banner tone="danger" title="These runs cannot be compared">{errorText(cmp.error)}</Banner> : null}
            {cmp.data ? <ObjectCompare data={cmp.data} newer={newer} older={older} /> : cmp.isLoading ? <TableSkeleton rows={4} label="Comparing" /> : null}
            {cmp.data ? <RecordCompare older={older} newer={newer} object={object || undefined} canPin={can("analyse")}
              onPinned={() => qc.invalidateQueries({ queryKey: ["versions.list"] })} /> : null}
          </div>
        ) : list.isLoading ? <TableSkeleton rows={4} label="Loading runs" /> : <Banner tone="warning" title="One of these runs was not found" />}
      </DetailDrawer>
    </div>
  );
}

/** The pair side by side in one table: older, newer, change. */
function PairSummary({ older, newer, object }: { older: Version; newer: Version; object: string }) {
  const a = scoped(older.dqs_summary, object || undefined), b = scoped(newer.dqs_summary, object || undefined);
  const da = averageDqs(a), db = averageDqs(b);
  const rows: Array<{ k: string; a: number | null; b: number | null; digits?: number }> = [
    { k: "Score", a: da, b: db },
    { k: "Critical failures", a: sumCounts(a, "critical_count"), b: sumCounts(b, "critical_count"), digits: 0 },
    { k: "High failures", a: sumCounts(a, "high_count"), b: sumCounts(b, "high_count"), digits: 0 },
    { k: "Checks run", a: sumCounts(a, "total_checks"), b: sumCounts(b, "total_checks"), digits: 0 },
    { k: "Objects", a: Object.keys(a ?? {}).length, b: Object.keys(b ?? {}).length, digits: 0 },
  ];
  const head = (v: Version) => (
    <th scope="col">
      <div className="ui-cell-stack">
        <span className="ui-cell-stack__main">{versionName(v)}{v.metadata?.baseline ? " (baseline)" : ""}</span>
        <span className="ui-cell-stack__sub"><span>{new Date(v.run_at).toLocaleString()}</span><Mono>{v.id.slice(0, 8)}</Mono></span>
      </div>
    </th>
  );
  return (
    <SectionCard title="Comparison" meta={object ? formatModuleName(object) : "All objects"} flush>
      <div className="ui-matrix-scroll">
        <table className="ui-mini-table">
          <thead><tr><th scope="col">Measure</th>{head(older)}{head(newer)}<th scope="col" className="aurora-number">Change</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <th scope="row">{r.k}</th>
                <td className="aurora-number">{r.a === null ? "" : r.a.toFixed(r.digits ?? 1)}</td>
                <td className="aurora-number">{r.b === null ? "" : r.b.toFixed(r.digits ?? 1)}</td>
                <td className="aurora-number">{r.a === null || r.b === null ? "" : signed(Math.round((r.b - r.a) * 10) / 10, r.digits ?? 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

type CompareData = Awaited<ReturnType<typeof compareVersions>>;

function CheckList({ items, versionId }: { items: CompareData["checks"]["newly_failing"]; versionId: string }) {
  if (!items.length) return <EmptyState>None.</EmptyState>;
  return (
    <ul className="ui-ranked">
      {items.map((c) => (
        <li key={`${c.module}-${c.check_id}`}>
          <Link href={findingsHref({ version_id: versionId, module: c.module, check_id: c.check_id })}>
            <Mono>{c.check_id}</Mono>
            <span className="ui-ranked__title">{formatModuleName(c.module)}</span>
            <span className="ui-ranked__num">{(c.v2_affected || c.v1_affected).toLocaleString()} records</span>
            <span className="ui-ranked__meta"><StatusBadge status={c.severity as Status}>{cap(c.severity)}</StatusBadge></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ObjectCompare({ data, newer, older }: { data: CompareData; newer: Version; older: Version }) {
  const dims = Array.from(new Set(Object.values(data.delta).flatMap((d) => Object.keys(d.dimensions))));
  return (
    <>
      <SectionCard title="Object scores" meta="Change is newer minus older" flush>
        <div className="ui-matrix-scroll">
          <table className="ui-mini-table">
            <thead><tr><th>Object</th><th className="aurora-number">Older</th><th className="aurora-number">Newer</th><th className="aurora-number">DQS change</th>{dims.map((d) => <th key={d} className="aurora-number">{cap(d)}</th>)}</tr></thead>
            <tbody>
              {Object.entries(data.delta).map(([m, d]) => (
                <tr key={m}>
                  <td><Link href={findingsHref({ version_id: newer.id, module: m })} className="ui-link">{formatModuleName(m)}</Link></td>
                  <td className="aurora-number">{d.v1_score.toFixed(1)}</td>
                  <td className="aurora-number">{d.v2_score.toFixed(1)}</td>
                  <td className="aurora-number">{signed(d.dqs_change)}</td>
                  {dims.map((dim) => <td key={dim} className="aurora-number">{signed(d.dimensions[dim]?.change ?? null)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <div className="ui-columns">
        <SectionCard title="Newly failing checks" meta={data.checks.newly_failing.length} flush>
          <CheckList items={data.checks.newly_failing} versionId={newer.id} />
        </SectionCard>
        <SectionCard title="Fixed checks" meta={data.checks.fixed.length} flush>
          <CheckList items={data.checks.fixed} versionId={older.id} />
        </SectionCard>
      </div>
      <p className="ui-micro">A check counts only when it ran cleanly in both versions; one that errored or was not run in either is left out.</p>
    </>
  );
}

const CHANGE_LABEL = { new: "Newly failing", resolved: "No longer failing", persisting: "Still failing" } as const;

function RecordCompare({ older, newer, object, canPin, onPinned }: { older: Version; newer: Version; object?: string; canPin: boolean; onPinned: () => void }) {
  const [open, setOpen] = useState<{ check: string; module: string; change: "new" | "resolved" | "persisting" } | null>(null);
  const diff = useQuery({ queryKey: ["versions.records", newer.id, older.id, object], retry: false, queryFn: () => compareRecords(newer.id, older.id, object) });
  const keys = useQuery({
    queryKey: ["versions.record-keys", open?.check, open?.change, older.id, newer.id], enabled: !!open,
    queryFn: () => compareRecordKeys(open!.check, { v1: older.id, v2: newer.id, change: open!.change, limit: 200 }),
  });
  const pin = useMutation({ mutationFn: () => pinBaseline(older.id), onSuccess: () => { toast.success("Baseline pinned"); onPinned(); }, onError: (e) => toast.error(errorText(e)) });
  const d = diff.data;
  const changed = (d?.checks ?? []).filter((c) => c.new || c.resolved || c.persisting);
  return (
    <SectionCard title="Record-level change"
      action={older.metadata?.baseline ? <span className="ui-note">The older version is the baseline</span>
        : canPin ? <Button variant="secondary" size="sm" onClick={() => pin.mutate()} disabled={pin.isPending}>Pin older version as baseline</Button> : null}>
      {diff.isError ? <Banner tone="warning" title="Record-level comparison unavailable">{errorText(diff.error)}</Banner> : d ? (
        <div className="ui-stack">
          <p className="ui-note">
            <strong>{d.totals.new.toLocaleString()}</strong> newly failing, <strong>{d.totals.resolved.toLocaleString()}</strong> no longer failing, <strong>{d.totals.persisting.toLocaleString()}</strong> still failing.
          </p>
          {changed.length ? (
            <div className="ui-matrix-scroll">
              <table className="ui-mini-table">
                <thead><tr><th>Check</th><th>Object</th><th>Severity</th><th className="aurora-number">New</th><th className="aurora-number">Resolved</th><th className="aurora-number">Persisting</th></tr></thead>
                <tbody>
                  {changed.map((c) => (
                    <tr key={`${c.module}-${c.check_id}`}>
                      <td><Mono>{c.check_id}</Mono>{c.comparable ? null : <span className="ui-micro"> Not comparable</span>}</td>
                      <td>{formatModuleName(c.module)}</td>
                      <td><StatusBadge status={c.severity as Status}>{cap(c.severity)}</StatusBadge></td>
                      {(["new", "resolved", "persisting"] as const).map((k) => (
                        <td key={k} className="aurora-number">
                          {c[k] ? <button type="button" className="ui-link-button" onClick={() => setOpen({ check: c.check_id, module: c.module, change: k })}
                            aria-label={`${CHANGE_LABEL[k]} records for ${c.check_id}`}>{c[k].toLocaleString()}</button> : "0"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState>No record moved between these versions.</EmptyState>}
        </div>
      ) : <TableSkeleton rows={4} label="Comparing records" />}
      {open ? (
        <div className="ui-stack">
          <p className="ui-note">
            {CHANGE_LABEL[open.change]} records for <Mono>{open.check}</Mono>.{" "}
            <Link className="ui-link" href={`/issues?${new URLSearchParams({ check_id: open.check, module: open.module, status: open.change === "resolved" ? "resolved" : "open", version_id: open.change === "resolved" ? older.id : newer.id })}`}>Open these in failing records</Link>
            {" "}<button type="button" className="ui-link-button" onClick={() => setOpen(null)}>Hide</button>
          </p>
          {keys.isLoading ? <TableSkeleton rows={4} label="Loading record keys" /> : (
            <ul className="ui-keys">{(keys.data?.record_keys ?? []).map((k) => <li key={k}><Mono>{k}</Mono></li>)}</ul>
          )}
          {(keys.data?.record_keys.length ?? 0) >= 200 ? <p className="ui-micro">The first 200 records are shown.</p> : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
