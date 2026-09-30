"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { PageHead, SectionHeader } from "@/components/meridian/atoms";
import { Sparkline } from "@/components/meridian/charts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  compareRecordKeys,
  compareRecords,
  compareVersions,
  getVersions,
  pinBaseline,
  type RecordDiffCheck,
} from "@/lib/api/versions";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, Panel, Select, Stack, Stat, KpiRail, Text, type ChipTone } from "@/components/aurora";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import { formatModuleName } from "@/lib/format";
import type { CheckChange, DQSSummary, Version, VersionComparison } from "@/types/api";

type DisplayStatus = "complete" | "failed" | "running" | "scheduled";

const STATUS_MAP: Record<DisplayStatus, { c: string; bg: string; l: string }> = {
  complete:  { c: "var(--mn-pos)",     bg: "var(--mn-pos-bg)",     l: "Complete" },
  failed:    { c: "var(--mn-neg)",     bg: "var(--mn-neg-bg)",     l: "Failed" },
  running:   { c: "var(--mn-primary)", bg: "var(--mn-primary-50)", l: "Running" },
  scheduled: { c: "var(--mn-ink-500)", bg: "rgba(15,23,42,0.05)",  l: "Scheduled" },
};

function mapStatus(s: Version["status"]): DisplayStatus {
  if (s === "complete" || s === "agents_complete" || s === "ai_enriched") return "complete";
  if (s === "failed" || s === "agents_failed") return "failed";
  if (s === "running" || s === "agents_running" || s === "ai_enriching" || s === "agents_enqueued") return "running";
  return "scheduled";
}

function isComplete(v: Version): boolean {
  return mapStatus(v.status) === "complete" && !!v.dqs_summary;
}

function averageDqs(summary: Record<string, DQSSummary> | null): number | null {
  if (!summary) return null;
  const scores = Object.values(summary).map((m) => m.composite_score);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function sumCounts(
  summary: Record<string, DQSSummary> | null,
  key: keyof DQSSummary,
): number {
  if (!summary) return 0;
  return Object.values(summary).reduce((a, m) => a + ((m[key] as number | undefined) ?? 0), 0);
}

/** Only the chosen object's summary when one is chosen. */
function scoped(summary: Record<string, DQSSummary> | null, module?: string): Record<string, DQSSummary> | null {
  if (!summary || !module) return summary;
  return summary[module] ? { [module]: summary[module] } : {};
}

/** The API's own refusal reason (e.g. versions of different systems), else the transport error. */
function errorText(e: unknown): string {
  if (isAxiosError<{ detail?: unknown }>(e) && typeof e.response?.data?.detail === "string") return e.response.data.detail;
  return (e as Error).message;
}

const findingsHref = (p: Record<string, string>) => `/findings?${new URLSearchParams(p)}`;

function StatusBadge({ status }: { status: DisplayStatus }) {
  const m = STATUS_MAP[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 7px",
        borderRadius: 4,
        background: m.bg,
        color: m.c,
        font: "700 9.5px/1 'JetBrains Mono', monospace",
        letterSpacing: "0.1em",
      }}
    >
      {m.l.toUpperCase()}
    </span>
  );
}

function formatDuration(start: string, end?: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms <= 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function VersionsPage() {
  return (
    <Suspense>
      <VersionsWorkspace />
    </Suspense>
  );
}

/** The pair being compared, the object and the system live in the URL (?v1=&v2=&module=&system_id=). */
function VersionsWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const systemId = params.get("system_id") ?? undefined;
  const object = params.get("module") ?? undefined;
  const urlPair = [params.get("v1"), params.get("v2")].filter((x): x is string => Boolean(x));
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["versions.list", { limit: 100, system_id: systemId }],
    queryFn: () => getVersions({ limit: 100, system_id: systemId }),
  });

  const versions = useMemo(() => data?.versions ?? [], [data]);
  const completed = useMemo(() => versions.filter(isComplete), [versions]);
  const trend = useMemo(
    () =>
      completed
        .slice(0, 20)
        .slice()
        .reverse()
        .map((v) => averageDqs(scoped(v.dqs_summary, object)))
        .filter((n): n is number => n !== null),
    [completed, object],
  );

  const replace = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`${pathname}?${q}`, { scroll: false });
  };
  const byId = (id: string) => versions.find((v) => v.id === id);
  /** Older run first, when both runs are in the list. */
  const ordered = (ids: string[]) => {
    const [x, y] = ids.map(byId);
    return x && y && new Date(x.run_at) > new Date(y.run_at) ? [ids[1], ids[0]] : ids;
  };

  // Seed comparison with the two most recent completed versions (older first).
  const pair = urlPair.length > 0 ? urlPair : completed.slice(0, 2).map((v) => v.id).reverse();
  const toggle = (id: string) => {
    const next = pair.includes(id) ? pair.filter((x) => x !== id) : pair.length >= 2 ? [pair[1], id] : [...pair, id];
    const [v1, v2] = ordered(next);
    replace({ v1, v2 });
  };

  const [id1, id2] = pair.length === 2 ? ordered(pair) : [];
  const cmp = useQuery({
    queryKey: ["versions.compare", id1, id2, object],
    queryFn: () => compareVersions(id1 as string, id2 as string, object),
    enabled: Boolean(id1 && id2),
  });
  const a = (id1 ? byId(id1) : undefined) ?? cmp.data?.v1;
  const b = (id2 ? byId(id2) : undefined) ?? cmp.data?.v2;
  const objects = Array.from(new Set([
    ...Object.keys(a?.dqs_summary ?? {}), ...Object.keys(b?.dqs_summary ?? {}), ...(object ? [object] : []),
  ])).sort();

  if (isLoading) {
    return (
      <>
        <PageHead title="Versions" route="Report · /versions" sub="Loading runs…" />
        <Skeleton className="h-40 rounded-[10px]" />
        <Skeleton className="h-20 rounded-[10px] mt-4" />
        <Skeleton className="h-[420px] rounded-[10px] mt-4" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead title="Versions" route="Report · /versions" sub="Failed to load runs." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/versions</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Versions"
        route="Report · /versions"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{versions.length} runs</strong> in history ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{completed.length} complete</strong>.
          </>
        }
        actions={
          <>
            {systemId && (
              <span data-theme="light">
                <Chip onDismiss={() => replace({ system_id: undefined })}>system · {systemId.slice(0, 8)}</Chip>
              </span>
            )}
            <SearchField value={search} onChange={setSearch} placeholder="Filter runs…" />
          </>
        }
      />

      <div className="mn-card mn-card-pad" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span className="mn-eyebrow">Compare runs · {pair.length} selected</span>
          <span data-theme="light">
            <Select aria-label="Object" value={object ?? ""} onValueChange={(v) => replace({ module: v || undefined })}
              options={[{ value: "", label: "All objects" }, ...objects.map((o) => ({ value: o, label: formatModuleName(o) }))]} />
          </span>
        </div>
        {a && b ? (
          <div className="mn-compare">
            <CompareSide v={a} module={object} />
            <CompareDelta older={a} newer={b} module={object} />
            <CompareSide v={b} module={object} />
          </div>
        ) : (
          <p style={{ color: "var(--mn-ink-500)", marginTop: 12 }}>
            {cmp.error ? errorText(cmp.error) : "Tick two completed runs below to compare."}
          </p>
        )}
      </div>

      {a && b && (
        <ObjectCompare data={cmp.data} error={cmp.error} olderId={a.id} newerId={b.id} />
      )}

      {a && b && <RecordCompare older={a} newer={b} module={object} />}

      {trend.length >= 2 && (
        <div className="mn-card mn-card-pad" style={{ marginBottom: 18 }}>
          <SectionHeader
            title={object ? `${formatModuleName(object)} DQS across runs` : "DQS across runs"}
            caption={`Last ${trend.length} completed runs · mean ${(trend.reduce((x, y) => x + y, 0) / trend.length).toFixed(1)}`}
          />
          <div style={{ marginTop: 8 }}>
            <Sparkline data={trend} width={1100} height={120} stroke="var(--mn-primary)" pulse />
          </div>
        </div>
      )}

      <SectionHeader
        title="Run history"
        caption={
          search.trim()
            ? `${versions.filter((v) => matchesSearch(v, search)).length} of ${versions.length} runs match`
            : "Click two rows to compare"
        }
      />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20, width: 80 }}>Compare</th>
                <th>Version</th>
                <th>Run</th>
                <th>Status</th>
                <th className="right">DQS</th>
                <th className="right">Critical</th>
                <th className="right">High</th>
                <th className="right">Checks</th>
                <th>Duration</th>
                <th>Modules</th>
              </tr>
            </thead>
            <tbody>
              {versions.filter((v) => matchesSearch(v, search)).map((v) => {
                const inComparison = pair.includes(v.id);
                const status = mapStatus(v.status);
                const dqs = averageDqs(v.dqs_summary);
                const critical = sumCounts(v.dqs_summary, "critical_count");
                const high = sumCounts(v.dqs_summary, "high_count");
                const checks = sumCounts(v.dqs_summary, "total_checks");
                const dur = formatDuration(v.run_at);
                const modules = v.metadata?.modules ?? [];
                return (
                  <tr
                    key={v.id}
                    className={inComparison ? "selected" : ""}
                    onClick={() => toggle(v.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ paddingLeft: 20 }}>
                      <span className={`mn-checkbox ${inComparison ? "on" : ""}`}>
                        {inComparison && (
                          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                            <path
                              d="m2.5 6.5 2.5 2.5 5-5.5"
                              stroke="white"
                              strokeWidth="2"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </td>
                    <td className="mn-tabular" style={{ font: "600 11.5px/1 'JetBrains Mono', monospace" }}>
                      {v.id.slice(0, 8)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)" }}>
                        {v.label ?? "Unlabelled run"}
                      </div>
                      <div
                        className="mn-tabular"
                        style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)", marginTop: 2 }}
                      >
                        {new Date(v.run_at).toLocaleString()}
                      </div>
                    </td>
                    <td><StatusBadge status={status} /></td>
                    <td className="right mn-tabular" style={{ fontWeight: 600 }}>
                      {dqs?.toFixed(1) ?? "—"}
                    </td>
                    <td className="right mn-tabular" style={{ color: critical > 0 ? "var(--mn-neg)" : "var(--mn-ink-300)" }}>
                      {critical}
                    </td>
                    <td className="right mn-tabular" style={{ color: high > 0 ? "var(--mn-warn)" : "var(--mn-ink-300)" }}>
                      {high}
                    </td>
                    <td className="right mn-tabular">{checks.toLocaleString()}</td>
                    <td className="mn-tabular" style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                      {dur}
                    </td>
                    <td>
                      <span
                        className="mn-tabular"
                        style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {modules.length}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {versions.filter((v) => matchesSearch(v, search)).length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    {versions.length === 0 ? "No analysis versions yet." : "No runs match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function CompareSide({ v, module }: { v: Version; module?: string }) {
  const summary = scoped(v.dqs_summary, module);
  const dqs = averageDqs(summary);
  const critical = sumCounts(summary, "critical_count");
  const checks = sumCounts(summary, "total_checks");
  return (
    <div className="mn-compare-side">
      <div className="mn-compare-head">
        <span className="mn-tabular" style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
          {v.id.slice(0, 8)}
        </span>
        <StatusBadge status={mapStatus(v.status)} />
      </div>
      <div className="mn-compare-title">{v.label ?? "Unlabelled run"}</div>
      <div className="mn-compare-date">{new Date(v.run_at).toLocaleString()}</div>
      <div className="mn-compare-stats">
        <div><span className="mn-eyebrow">DQS</span><span className="v mn-tabular">{dqs?.toFixed(1) ?? "—"}</span></div>
        <div><span className="mn-eyebrow">Checks</span><span className="v mn-tabular">{checks.toLocaleString()}</span></div>
        <div><span className="mn-eyebrow">Critical</span><span className="v mn-tabular" style={{ color: "var(--mn-neg)" }}>{critical}</span></div>
        <div><span className="mn-eyebrow">Modules</span><span className="v mn-tabular">{Object.keys(summary ?? {}).length}</span></div>
      </div>
    </div>
  );
}

/** Newer minus older. */
function CompareDelta({ older, newer, module }: { older: Version; newer: Version; module?: string }) {
  const sa = scoped(newer.dqs_summary, module);
  const sb = scoped(older.dqs_summary, module);
  const da = averageDqs(sa) ?? 0;
  const db = averageDqs(sb) ?? 0;
  const delta = +(da - db).toFixed(1);
  const cra = sumCounts(sa, "critical_count");
  const crb = sumCounts(sb, "critical_count");
  const ha = sumCounts(sa, "high_count");
  const hb = sumCounts(sb, "high_count");
  return (
    <div className="mn-compare-arrow">
      <div className="mn-compare-delta-wrap">
        <span className="mn-eyebrow">Δ DQS</span>
        <span
          className="mn-compare-delta"
          style={{ color: delta >= 0 ? "var(--mn-pos)" : "var(--mn-neg)" }}
        >
          {delta > 0 ? "+" : ""}
          {delta.toFixed(1)}
        </span>
        <span style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}>pts</span>
        <div className="mn-compare-row">
          <span>Critical</span>
          <span
            className="mn-tabular"
            style={{
              color: cra < crb ? "var(--mn-pos)" : cra > crb ? "var(--mn-neg)" : "var(--mn-ink-400)",
            }}
          >
            {cra > crb ? "+" : ""}
            {cra - crb}
          </span>
        </div>
        <div className="mn-compare-row">
          <span>High</span>
          <span
            className="mn-tabular"
            style={{
              color: ha < hb ? "var(--mn-pos)" : ha > hb ? "var(--mn-neg)" : "var(--mn-ink-400)",
            }}
          >
            {ha > hb ? "+" : ""}
            {ha - hb}
          </span>
        </div>
      </div>
    </div>
  );
}

const deltaTone = (n: number | null): ChipTone => (n === null || n === 0 ? "neutral" : n > 0 ? "success" : "danger");
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`);

/** Per-object DQS and dimension deltas, and the checks that started or stopped failing. */
function ObjectCompare({
  data,
  error,
  olderId,
  newerId,
}: {
  data: VersionComparison | undefined;
  error: unknown;
  olderId: string;
  newerId: string;
}) {
  const dims = Array.from(new Set(Object.values(data?.delta ?? {}).flatMap((d) => Object.keys(d.dimensions ?? {})))).sort();
  const checkList = (title: string, items: CheckChange[], versionId: string, tone: ChipTone) => (
    <Stack gap={2}>
      <Text className="font-semibold">{title} <Chip tone={items.length ? tone : "neutral"}>{items.length}</Chip></Text>
      {items.length === 0 ? <Text variant="text-small" tone="muted">None.</Text> : (
        <Stack gap={1}>
          {items.map((c) => (
            <Link key={c.check_id} className="text-[13px] underline"
              href={findingsHref({ version_id: versionId, module: c.module, check_id: c.check_id })}>
              <span className="font-mono">{c.check_id}</span> · {formatModuleName(c.module)} · {c.severity} ·{" "}
              {(c.v2_affected || c.v1_affected).toLocaleString()} records
            </Link>
          ))}
        </Stack>
      )}
    </Stack>
  );
  return (
    <div data-theme="light" style={{ marginBottom: 18 }}>
      <Panel title="Object scores">
        {error ? <Banner tone="danger">{errorText(error)}</Banner> : !data ? <Text tone="muted">Comparing scores…</Text> : (
          <Stack gap={5}>
            <div className="overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[var(--aurora-fg-tertiary)]">
                  <tr>
                    <th className="py-1.5">Object</th><th className="text-right">Older</th><th className="text-right">Newer</th>
                    <th className="text-right">Δ DQS</th>
                    {dims.map((d) => <th key={d} className="text-right capitalize">Δ {d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.delta).map(([m, d]) => (
                    <tr key={m} className="border-t border-[var(--aurora-canvas-line)]">
                      <td className="py-1.5">
                        <Link className="underline" href={findingsHref({ version_id: newerId, module: m })}>{formatModuleName(m)}</Link>
                      </td>
                      <td className="text-right aurora-number">{d.v1_score.toFixed(1)}</td>
                      <td className="text-right aurora-number">{d.v2_score.toFixed(1)}</td>
                      <td className="text-right"><Chip tone={deltaTone(d.dqs_change)}>{signed(d.dqs_change)}</Chip></td>
                      {dims.map((k) => {
                        const c = d.dimensions?.[k]?.change ?? null;
                        return <td key={k} className="text-right"><Chip tone={deltaTone(c)}>{signed(c)}</Chip></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {checkList("Newly failing checks", data.checks.newly_failing, newerId, "danger")}
              {checkList("Fixed checks", data.checks.fixed, olderId, "success")}
            </div>
            <Text variant="text-small" tone="secondary">
              A check counts only when it ran cleanly in both runs; a check that errored or was not run in either is left out.
            </Text>
          </Stack>
        )}
      </Panel>
    </div>
  );
}

type Change = "new" | "resolved" | "persisting";

/** Record-level delta: which SAP records started failing, stopped failing, or still fail. */
function RecordCompare({ older, newer, module }: { older: Version; newer: Version; module?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<{ check: string; change: Change; module: string } | null>(null);
  const { data, error } = useQuery({
    queryKey: ["compare.records", older.id, newer.id, module],
    queryFn: () => compareRecords(newer.id, older.id, module),
  });
  const { data: keys } = useQuery({
    queryKey: ["compare.keys", older.id, newer.id, open],
    queryFn: () => compareRecordKeys(open!.check, { v1: older.id, v2: newer.id, change: open!.change, limit: 200 }),
    enabled: Boolean(open),
  });
  const pin = useMutation({
    mutationFn: () => pinBaseline(older.id),
    onSuccess: () => { toast.success("Pinned as baseline — later runs of this system compare against it by default"); qc.invalidateQueries({ queryKey: ["versions.list"] }); },
    onError: (e) => toast.error((e as Error).message || "Could not pin the baseline"),
  });
  const isBaseline = older.metadata?.baseline === true;
  const cell = (c: RecordDiffCheck, change: Change, tone: "danger" | "success" | "warning") =>
    c[change] ? (
      <button type="button" onClick={() => setOpen({ check: c.check_id, change, module: c.module })}>
        <Chip tone={tone} selected={open?.check === c.check_id && open.change === change}>{c[change].toLocaleString()}</Chip>
      </button>
    ) : <span className="text-[var(--aurora-fg-muted)]">0</span>;

  return (
    <div data-theme="light" style={{ marginBottom: 18 }}>
      <Panel title="Record-level change"
        action={isBaseline ? <Chip tone="info">baseline</Chip> : (
          <Button size="sm" variant="secondary" disabled={pin.isPending} onClick={() => pin.mutate()}>Pin older run as baseline</Button>
        )}>
        {error ? <Banner tone="danger">{errorText(error)}</Banner> : !data ? <Text tone="muted">Comparing failing records…</Text> : (
          <Stack gap={4}>
            <KpiRail>
              <Stat label="Newly failing records" value={data.totals.new.toLocaleString()} tone={data.totals.new ? "danger" : "neutral"} />
              <Stat label="No longer failing" value={data.totals.resolved.toLocaleString()} tone={data.totals.resolved ? "success" : "neutral"} />
              <Stat label="Still failing" value={data.totals.persisting.toLocaleString()} tone={data.totals.persisting ? "warning" : "neutral"} />
            </KpiRail>
            <Text variant="text-small" tone="secondary">
              Checks marked &ldquo;not comparable&rdquo; did not run cleanly in both runs (skipped, errored, or more than
              100,000 failing keys) — their counts are shown but excluded from the totals.
            </Text>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-[var(--aurora-elev-1-bg)] text-left text-[var(--aurora-fg-tertiary)]">
                  <tr><th className="py-1.5">Check</th><th>Module</th><th>Severity</th>
                    <th className="text-right">New</th><th className="text-right">Resolved</th><th className="text-right">Persisting</th><th /></tr>
                </thead>
                <tbody>
                  {data.checks.filter((c) => c.new || c.resolved || c.persisting).map((c) => (
                    <tr key={c.check_id} className="border-t border-[var(--aurora-canvas-line)]">
                      <td className="py-1.5 font-mono">{c.check_id}</td>
                      <td>{c.module}</td>
                      <td>{c.severity}</td>
                      <td className="text-right">{cell(c, "new", "danger")}</td>
                      <td className="text-right">{cell(c, "resolved", "success")}</td>
                      <td className="text-right">{cell(c, "persisting", "warning")}</td>
                      <td className="pl-2">{!c.comparable && <Chip>not comparable</Chip>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open && keys && (
              <Stack gap={2}>
                <Stack direction="row" justify="between" align="center">
                  <Text className="font-semibold">{open.change} records · <span className="font-mono">{open.check}</span></Text>
                  <Link className="text-[13px] underline" href={`/issues?${new URLSearchParams({
                    check_id: open.check, module: open.module,
                    status: open.change === "resolved" ? "resolved" : "open",
                    // resolved records failed in the older run; new and persisting ones fail in the newer
                    version_id: open.change === "resolved" ? older.id : newer.id,
                  })}`}>
                    Open in Issues
                  </Link>
                </Stack>
                <Stack direction="row" gap={1} wrap>
                  {keys.record_keys.map((k) => <Chip key={k}><span className="font-mono">{k}</span></Chip>)}
                </Stack>
                {keys.record_keys.length === 200 && <Text variant="text-small" tone="muted">First 200 shown — the Issues work list has all of them.</Text>}
              </Stack>
            )}
          </Stack>
        )}
      </Panel>
    </div>
  );
}
