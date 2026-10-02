"use client";

/**
 * Data → Analyses: every analysed version, two of them compared object by
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
import {
  Banner, Button, Chip, DataTable, Drawer, EmptyState, KpiRail, LineChart, Select, Stack, Stat, Text,
  type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
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
const STATUS_TONE: Record<Display, ChipTone> = { complete: "success", failed: "danger", running: "info", scheduled: "neutral" };
const isComplete = (v: Version) => displayStatus(v.status) === "complete" && !!v.dqs_summary;
const scoped = (s: Record<string, DQSSummary> | null, object?: string) => !s ? null : object ? (s[object] ? { [object]: s[object] } : {}) : s;
function averageDqs(s: Record<string, DQSSummary> | null): number | null {
  const scores = Object.values(s ?? {}).map((m) => m.composite_score);
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
}
const sumCounts = (s: Record<string, DQSSummary> | null, key: "critical_count" | "high_count" | "total_checks") =>
  Object.values(s ?? {}).reduce((a, m) => a + m[key], 0);
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`);
const deltaTone = (n: number | null, lowerIsBetter = false): ChipTone =>
  n === null || n === 0 ? "neutral" : (n > 0) !== lowerIsBetter ? "success" : "danger";
function errorText(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : (e as Error)?.message || "Comparison failed";
}
const findingsHref = (p: Record<string, string>) => `/findings?${new URLSearchParams(p)}`;

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

  // the pair: URL first, else the two most recent completed versions, older first
  const pair = useMemo<string[]>(() => {
    const v1 = search.get("v1"), v2 = search.get("v2");
    if (v1 && v2) return [v1, v2];
    return completed.slice(0, 2).reverse().map((v) => v.id);
  }, [search, completed]);
  const toggle = (id: string) => {
    let next = pair.includes(id) ? pair.filter((p) => p !== id) : pair.length >= 2 ? [pair[1], id] : [...pair, id];
    next = next.map((x) => versions.find((v) => v.id === x)).filter((v): v is Version => !!v)
      .sort((a, b) => a.run_at.localeCompare(b.run_at)).map((v) => v.id);
    setParams({ v1: next[0] ?? null, v2: next[1] ?? null });
  };
  const older = versions.find((v) => v.id === pair[0]);
  const newer = versions.find((v) => v.id === pair[1]);

  const cmp = useQuery({
    queryKey: ["versions.compare", pair[0], pair[1], object], enabled: pair.length === 2, retry: false,
    queryFn: () => compareVersions(pair[0], pair[1], object || undefined),
  });
  const objects = useMemo(() => Array.from(new Set([...Object.keys(older?.dqs_summary ?? {}), ...Object.keys(newer?.dqs_summary ?? {}), ...(object ? [object] : [])])).sort(), [older, newer, object]);
  const trend = useMemo(() => completed.slice(0, 20).reverse().map((v) => ({ run: relativeTime(v.run_at), id: v.id, dqs: averageDqs(scoped(v.dqs_summary, object || undefined)) ?? 0 })), [completed, object]);

  const columns = useMemo<ColumnDef<Version, unknown>[]>(() => [
    { id: "pick", header: "", meta: meta({ width: 44, align: "center" }), cell: ({ row }) => (
      <input type="checkbox" aria-label={`Compare ${row.original.label ?? row.original.id.slice(0, 8)}`} checked={pair.includes(row.original.id)} onChange={() => toggle(row.original.id)} onClick={(e) => e.stopPropagation()} />) },
    { id: "when", header: "Run", meta: meta({ sticky: "start", width: 220 }), cell: ({ row }) => (
      <span><strong>{row.original.label ?? row.original.metadata?.file_name ?? row.original.id.slice(0, 8)}</strong>
        <Text variant="text-micro" tone="muted" as="div">{relativeTime(row.original.run_at)} · <span className="aurora-number">{row.original.id.slice(0, 8)}</span>{row.original.metadata?.baseline ? " · baseline" : ""}</Text></span>) },
    { id: "status", header: "Status", meta: meta({ width: 110 }), cell: ({ row }) => <Chip tone={STATUS_TONE[displayStatus(row.original.status)]}>{displayStatus(row.original.status)}</Chip> },
    { id: "dqs", header: "DQS", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => { const d = averageDqs(scoped(row.original.dqs_summary, object || undefined)); return d === null ? "—" : d.toFixed(1); } },
    { id: "crit", header: "Critical", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => sumCounts(row.original.dqs_summary, "critical_count") },
    { id: "high", header: "High", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => sumCounts(row.original.dqs_summary, "high_count") },
    { id: "checks", header: "Checks", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => sumCounts(row.original.dqs_summary, "total_checks") },
    { id: "objects", header: "Objects", cell: ({ row }) => (row.original.metadata?.modules ?? []).map(formatModuleName).join(" · ") || "—" },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [pair, object, versions]);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Versions" value={versions.length} />
        <Stat label="Analysed" value={completed.length} tone={completed.length ? "success" : "neutral"} />
        <Stat label="Latest DQS" value={completed[0] ? (averageDqs(completed[0].dqs_summary) ?? "—") : "—"} />
        <Stat label="Baseline" value={versions.find((v) => v.metadata?.baseline)?.label ?? (versions.some((v) => v.metadata?.baseline) ? "set" : "none")} />
      </KpiRail>
      <Stack direction="row" gap={3} align="center" wrap className="aurora-filters">
        <Select aria-label="Object" placeholder="All objects" value={object} options={objects.map((o) => ({ value: o, label: formatModuleName(o) }))} onValueChange={(v) => setParams({ module: v || null })} />
        {systemId ? <Chip tone="info" onDismiss={() => setParams({ system_id: null })}>system · {systemId.slice(0, 8)}</Chip> : null}
        <Text variant="text-small" tone="secondary">Tick two versions to compare them; the older is always on the left.</Text>
      </Stack>

      {older && newer ? (
        <div className="aurora-compare">
          <Side v={older} object={object} />
          <Delta older={older} newer={newer} object={object} />
          <Side v={newer} object={object} />
        </div>
      ) : <Banner tone="info" title="Pick two analysed versions">The comparison, object scores and record-level change appear once two versions are ticked.</Banner>}
      {cmp.isError ? <Banner tone="danger" title="These versions cannot be compared">{errorText(cmp.error)}</Banner> : null}

      {cmp.data && older && newer ? <ObjectCompare data={cmp.data} newer={newer} older={older} /> : null}
      {older && newer && cmp.data ? <RecordCompare older={older} newer={newer} object={object || undefined} canPin={can("analyse")}
        onPinned={() => qc.invalidateQueries({ queryKey: ["versions.list"] })} /> : null}

      {trend.length >= 2 ? (
        <section>
          <Text as="h2" variant="text-lead" className="aurora-runs__h">DQS across the last {trend.length} analysed versions{object ? ` · ${formatModuleName(object)}` : ""}</Text>
          <LineChart data={trend} xKey="run" series={[{ key: "dqs", label: "DQS" }]} height={180} ariaLabel="DQS trend" yFormatter={(v) => v.toFixed(0)} />
        </section>
      ) : null}

      <Text as="h2" variant="text-lead" className="aurora-runs__h">Version history</Text>
      {list.isLoading ? <Text tone="muted">Reading versions.</Text> : versions.length ? (
        <DataTable columns={columns} data={versions} getRowId={(v) => v.id} onRowActivate={(v) => toggle(v.id)} ariaLabel="Version history" maxHeight="56vh" />
      ) : <EmptyState title="No versions yet." body="Import a file or download objects from a connected system to create the first one." />}
    </Stack>
  );
}

function Side({ v, object }: { v: Version; object: string }) {
  const s = scoped(v.dqs_summary, object || undefined);
  return (
    <div className="aurora-compare__side">
      <Stack direction="row" gap={2} align="center"><span className="aurora-number">{v.id.slice(0, 8)}</span><Chip tone={STATUS_TONE[displayStatus(v.status)]}>{displayStatus(v.status)}</Chip>{v.metadata?.baseline ? <Chip tone="info">baseline</Chip> : null}</Stack>
      <Text variant="text-lead">{v.label ?? v.metadata?.file_name ?? "Version"}</Text>
      <Text variant="text-small" tone="secondary">{new Date(v.run_at).toLocaleString()}</Text>
      <KpiRail>
        <Stat label="DQS" value={averageDqs(s) ?? "—"} />
        <Stat label="Checks" value={sumCounts(s, "total_checks")} />
        <Stat label="Critical" value={sumCounts(s, "critical_count")} tone={sumCounts(s, "critical_count") ? "danger" : "neutral"} />
        <Stat label="Objects" value={Object.keys(s ?? {}).length} />
      </KpiRail>
    </div>
  );
}

function Delta({ older, newer, object }: { older: Version; newer: Version; object: string }) {
  const a = scoped(older.dqs_summary, object || undefined), b = scoped(newer.dqs_summary, object || undefined);
  const dqs = averageDqs(a) !== null && averageDqs(b) !== null ? Math.round(((averageDqs(b) as number) - (averageDqs(a) as number)) * 10) / 10 : null;
  const crit = sumCounts(b, "critical_count") - sumCounts(a, "critical_count");
  const high = sumCounts(b, "high_count") - sumCounts(a, "high_count");
  return (
    <div className="aurora-compare__delta">
      <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Δ newer − older</Text>
      <Text variant="display-sm" className="aurora-number" tone={dqs === null ? "muted" : dqs >= 0 ? "primary" : "danger"}>{signed(dqs)}</Text>
      <Text variant="text-micro" tone="muted">DQS points</Text>
      <Stack direction="row" gap={2} wrap>
        <Chip tone={deltaTone(crit, true)}>{signed(crit)} critical</Chip>
        <Chip tone={deltaTone(high, true)}>{signed(high)} high</Chip>
      </Stack>
    </div>
  );
}

function ObjectCompare({ data, newer, older }: { data: Awaited<ReturnType<typeof compareVersions>>; newer: Version; older: Version }) {
  const dims = Array.from(new Set(Object.values(data.delta).flatMap((d) => Object.keys(d.dimensions))));
  const list = (title: string, items: typeof data.checks.newly_failing, tone: ChipTone, versionId: string) => (
    <div>
      <Text variant="text-small" tone="secondary">{title} <Chip tone={items.length ? tone : "neutral"}>{items.length}</Chip></Text>
      {items.length ? (
        <ul className="aurora-exec__warnings">
          {items.map((c) => (
            <li key={`${c.module}-${c.check_id}`}>
              <Link href={findingsHref({ version_id: versionId, module: c.module, check_id: c.check_id })} className="aurora-link aurora-number">{c.check_id}</Link>
              <span> · {formatModuleName(c.module)} · {c.severity} · {(c.v2_affected || c.v1_affected).toLocaleString()} records</span>
            </li>
          ))}
        </ul>
      ) : <Text variant="text-small" tone="muted">None.</Text>}
    </div>
  );
  return (
    <section>
      <Text as="h2" variant="text-lead" className="aurora-runs__h">Object scores</Text>
      <table className="aurora-exec__table">
        <thead><tr><th>Object</th><th>Older</th><th>Newer</th><th>Δ DQS</th>{dims.map((d) => <th key={d}>Δ {d}</th>)}</tr></thead>
        <tbody>
          {Object.entries(data.delta).map(([m, d]) => (
            <tr key={m}>
              <td><Link href={findingsHref({ version_id: newer.id, module: m })} className="aurora-link">{formatModuleName(m)}</Link></td>
              <td className="aurora-number">{d.v1_score.toFixed(1)}</td>
              <td className="aurora-number">{d.v2_score.toFixed(1)}</td>
              <td><Chip tone={deltaTone(d.dqs_change)}>{signed(d.dqs_change)}</Chip></td>
              {dims.map((dim) => <td key={dim}><Chip tone={deltaTone(d.dimensions[dim]?.change ?? null)}>{signed(d.dimensions[dim]?.change ?? null)}</Chip></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="aurora-compare__lists">
        {list("Newly failing checks", data.checks.newly_failing, "danger", newer.id)}
        {list("Fixed checks", data.checks.fixed, "success", older.id)}
      </div>
      <Text variant="text-micro" tone="muted">A check counts only when it ran cleanly in both versions; one that errored or was not run in either is left out.</Text>
    </section>
  );
}

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
    <section>
      <Stack direction="row" gap={3} align="center" wrap>
        <Text as="h2" variant="text-lead" className="aurora-runs__h">Record-level change</Text>
        <span style={{ flex: 1 }} />
        {older.metadata?.baseline ? <Chip tone="info">older version is the baseline</Chip>
          : canPin ? <Button variant="secondary" size="sm" onClick={() => pin.mutate()} disabled={pin.isPending}>Pin older version as baseline</Button> : null}
      </Stack>
      {diff.isError ? <Banner tone="warning" title="Record-level comparison unavailable">{errorText(diff.error)}</Banner> : d ? (
        <Stack gap={3}>
          <KpiRail>
            <Stat label="Newly failing records" value={d.totals.new} tone={d.totals.new ? "danger" : "neutral"} />
            <Stat label="No longer failing" value={d.totals.resolved} tone={d.totals.resolved ? "success" : "neutral"} />
            <Stat label="Still failing" value={d.totals.persisting} tone={d.totals.persisting ? "warning" : "neutral"} />
          </KpiRail>
          {changed.length ? (
            <table className="aurora-exec__table">
              <thead><tr><th>Check</th><th>Object</th><th>Severity</th><th>New</th><th>Resolved</th><th>Persisting</th></tr></thead>
              <tbody>
                {changed.map((c) => (
                  <tr key={`${c.module}-${c.check_id}`}>
                    <td className="aurora-number">{c.check_id}{c.comparable ? "" : <Chip tone="neutral"> not comparable</Chip>}</td>
                    <td>{formatModuleName(c.module)}</td>
                    <td>{c.severity}</td>
                    {(["new", "resolved", "persisting"] as const).map((k) => (
                      <td key={k}>{c[k] ? <Chip tone={k === "new" ? "danger" : k === "resolved" ? "success" : "warning"} onClick={() => setOpen({ check: c.check_id, module: c.module, change: k })}>{c[k].toLocaleString()}</Chip> : "0"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Text variant="text-small" tone="muted">No record moved between these versions.</Text>}
        </Stack>
      ) : <Text tone="muted">Comparing records.</Text>}
      <Drawer open={!!open} onClose={() => setOpen(null)} ariaLabel="Record keys"
        header={open ? <Text variant="text-lead">{open.change} records · <span className="aurora-number">{open.check}</span></Text> : null}>
        {open ? (
          <Stack gap={3}>
            <Link className="aurora-link" href={`/issues?${new URLSearchParams({ check_id: open.check, module: open.module, status: open.change === "resolved" ? "resolved" : "open", version_id: open.change === "resolved" ? older.id : newer.id })}`}>Open in Failing records →</Link>
            <Stack direction="row" gap={1} wrap>{(keys.data?.record_keys ?? []).map((k) => <Chip key={k}><span className="aurora-number">{k}</span></Chip>)}</Stack>
            {(keys.data?.record_keys.length ?? 0) >= 200 ? <Text variant="text-micro" tone="muted">First 200 shown.</Text> : null}
          </Stack>
        ) : null}
      </Drawer>
    </section>
  );
}
