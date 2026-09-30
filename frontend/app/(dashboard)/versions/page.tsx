"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, SectionHeader } from "@/components/meridian/atoms";
import { Sparkline } from "@/components/meridian/charts";
import { Skeleton } from "@/components/ui/skeleton";
import { compareRecordKeys, compareRecords, getVersions, pinBaseline, type RecordDiffCheck } from "@/lib/api/versions";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, Panel, Stack, Stat, KpiRail, Text } from "@/components/aurora";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import type { DQSSummary, Version } from "@/types/api";

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
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["versions.list", { limit: 100 }],
    queryFn: () => getVersions({ limit: 100 }),
  });

  const versions = useMemo(() => data?.versions ?? [], [data]);
  const completed = useMemo(() => versions.filter(isComplete), [versions]);
  const trend = useMemo(
    () =>
      completed
        .slice(0, 20)
        .slice()
        .reverse()
        .map((v) => averageDqs(v.dqs_summary))
        .filter((n): n is number => n !== null),
    [completed],
  );

  // Seed comparison with two most recent completed versions.
  const compareDefaults = useMemo(() => completed.slice(0, 2).map((v) => v.id), [completed]);
  const effSelected = selected.length > 0 ? selected : compareDefaults;

  const a = versions.find((v) => v.id === effSelected[0]);
  const b = versions.find((v) => v.id === effSelected[1]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const base = prev.length > 0 ? prev : compareDefaults;
      if (base.includes(id)) return base.filter((x) => x !== id);
      if (base.length >= 2) return [base[1], id];
      return [...base, id];
    });
  };

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
          <SearchField value={search} onChange={setSearch} placeholder="Filter runs…" />
        }
      />

      <div className="mn-card mn-card-pad" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="mn-eyebrow">Compare runs · {effSelected.length} selected</span>
        </div>
        {a && b ? (
          <div className="mn-compare">
            <CompareSide v={a} />
            <CompareDelta a={a} b={b} />
            <CompareSide v={b} />
          </div>
        ) : (
          <p style={{ color: "var(--mn-ink-500)", marginTop: 12 }}>
            Tick two completed runs below to compare.
          </p>
        )}
      </div>

      {a && b && (
        <RecordCompare
          older={new Date(a.run_at) <= new Date(b.run_at) ? a : b}
          newer={new Date(a.run_at) <= new Date(b.run_at) ? b : a}
        />
      )}

      {trend.length >= 2 && (
        <div className="mn-card mn-card-pad" style={{ marginBottom: 18 }}>
          <SectionHeader
            title="DQS across runs"
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
                <th className="right">Records</th>
                <th>Duration</th>
                <th>Modules</th>
              </tr>
            </thead>
            <tbody>
              {versions.filter((v) => matchesSearch(v, search)).map((v) => {
                const inComparison = effSelected.includes(v.id);
                const status = mapStatus(v.status);
                const dqs = averageDqs(v.dqs_summary);
                const critical = sumCounts(v.dqs_summary, "critical_count");
                const high = sumCounts(v.dqs_summary, "high_count");
                const records = sumCounts(v.dqs_summary, "total_checks");
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
                    <td className="right mn-tabular">{records.toLocaleString()}</td>
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

function CompareSide({ v }: { v: Version }) {
  const dqs = averageDqs(v.dqs_summary);
  const critical = sumCounts(v.dqs_summary, "critical_count");
  const records = sumCounts(v.dqs_summary, "total_checks");
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
        <div><span className="mn-eyebrow">Records</span><span className="v mn-tabular">{records.toLocaleString()}</span></div>
        <div><span className="mn-eyebrow">Critical</span><span className="v mn-tabular" style={{ color: "var(--mn-neg)" }}>{critical}</span></div>
        <div><span className="mn-eyebrow">Modules</span><span className="v mn-tabular">{Object.keys(v.dqs_summary ?? {}).length}</span></div>
      </div>
    </div>
  );
}

function CompareDelta({ a, b }: { a: Version; b: Version }) {
  const da = averageDqs(a.dqs_summary) ?? 0;
  const db = averageDqs(b.dqs_summary) ?? 0;
  const delta = +(da - db).toFixed(1);
  const cra = sumCounts(a.dqs_summary, "critical_count");
  const crb = sumCounts(b.dqs_summary, "critical_count");
  const ha = sumCounts(a.dqs_summary, "high_count");
  const hb = sumCounts(b.dqs_summary, "high_count");
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

type Change = "new" | "resolved" | "persisting";

/** Record-level delta: which SAP records started failing, stopped failing, or still fail. */
function RecordCompare({ older, newer }: { older: Version; newer: Version }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<{ check: string; change: Change } | null>(null);
  const { data, error } = useQuery({
    queryKey: ["compare.records", older.id, newer.id],
    queryFn: () => compareRecords(newer.id, older.id),
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
  const isBaseline = (older.metadata as Record<string, unknown> | null)?.baseline === true;
  const cell = (c: RecordDiffCheck, change: Change, tone: "danger" | "success" | "warning") =>
    c[change] ? (
      <button type="button" onClick={() => setOpen({ check: c.check_id, change })}>
        <Chip tone={tone} selected={open?.check === c.check_id && open.change === change}>{c[change].toLocaleString()}</Chip>
      </button>
    ) : <span className="text-[var(--aurora-fg-muted)]">0</span>;

  return (
    <div data-theme="light" style={{ marginBottom: 18 }}>
      <Panel title="Record-level change"
        action={isBaseline ? <Chip tone="info">baseline</Chip> : (
          <Button size="sm" variant="secondary" disabled={pin.isPending} onClick={() => pin.mutate()}>Pin older run as baseline</Button>
        )}>
        {error ? <Banner tone="danger">{(error as Error).message}</Banner> : !data ? <Text tone="muted">Comparing failing records…</Text> : (
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
                  <Link className="text-[13px] underline" href={`/issues?check_id=${encodeURIComponent(open.check)}&status=${open.change === "resolved" ? "resolved" : "open"}`}>
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
