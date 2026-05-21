"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { ArrowRight, MoreH, SparklesIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getSystems, getSyncRuns } from "@/lib/api/systems";
import { copyToClipboard } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import type { SAPSystem, SyncRun } from "@/types/api";

type DisplayStatus = "ok" | "warn" | "fail";

const SM_STATUS: Record<DisplayStatus, { bg: string; fg: string; l: string }> = {
  ok:   { bg: "var(--mn-pos-bg)",  fg: "var(--mn-pos)",  l: "OK" },
  warn: { bg: "var(--mn-warn-bg)", fg: "var(--mn-warn)", l: "WARN" },
  fail: { bg: "var(--mn-neg-bg)",  fg: "var(--mn-neg)",  l: "FAIL" },
};

function mapStatus(r: SyncRun): DisplayStatus {
  if (r.status === "failed") return "fail";
  if (r.error_detail || (r.anomaly_flags?.length ?? 0) > 0) return "warn";
  return "ok";
}

function durationSec(r: SyncRun): number {
  if (!r.completed_at) return 0;
  return Math.max(0, Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000));
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface MergedRow {
  run: SyncRun;
  systemName: string;
}

export default function SyncMonPage() {
  const [search, setSearch] = useState("");
  const systemsQ = useQuery({
    queryKey: ["systems.list"],
    queryFn: getSystems,
  });

  const systems: SAPSystem[] = systemsQ.data ?? [];

  const runsResults = useQueries({
    queries: systems.map((s) => ({
      queryKey: ["systems.runs", s.id],
      queryFn: () => getSyncRuns(s.id, 25),
      enabled: systems.length > 0,
    })),
  });

  const loading = systemsQ.isLoading || runsResults.some((r) => r.isLoading);
  const error = systemsQ.error || runsResults.find((r) => r.error)?.error;

  const merged: MergedRow[] = useMemo(() => {
    const rows: MergedRow[] = [];
    systems.forEach((s, i) => {
      const runs = runsResults[i]?.data ?? [];
      for (const r of runs) rows.push({ run: r, systemName: s.name });
    });
    rows.sort((a, b) => new Date(b.run.started_at).getTime() - new Date(a.run.started_at).getTime());
    return rows.slice(0, 80);
  }, [systems, runsResults]);

  const last24hRows = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return merged.filter((m) => new Date(m.run.started_at).getTime() >= cutoff);
  }, [merged]);

  const summary = useMemo(() => {
    const success = last24hRows.filter((r) => mapStatus(r.run) === "ok").length;
    const warn = last24hRows.filter((r) => mapStatus(r.run) === "warn").length;
    const fail = last24hRows.filter((r) => mapStatus(r.run) === "fail").length;
    const completed = last24hRows.filter((r) => r.run.completed_at);
    const avgDur = completed.length === 0
      ? 0
      : Math.round(completed.reduce((a, r) => a + durationSec(r.run), 0) / completed.length);
    return {
      runs24h: last24hRows.length,
      success,
      warn,
      fail,
      avgDurSec: avgDur,
    };
  }, [last24hRows]);

  if (loading && merged.length === 0) {
    return (
      <>
        <PageHead title="Sync Monitor" route="Connect · /sync" sub="Loading sync runs…" />
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 18 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[10px]" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead title="Sync Monitor" route="Connect · /sync" sub="Failed to load sync history." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/systems/&lt;id&gt;/runs</code>.
        </div>
      </>
    );
  }

  const failedRun = last24hRows.find((r) => mapStatus(r.run) === "fail");

  return (
    <>
      <PageHead
        title="Sync Monitor"
        route="Connect · /sync"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{summary.runs24h} runs</strong> in the last 24h ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{summary.success} successful</strong>,{" "}
            <strong style={{ color: "var(--mn-neg)" }}>{summary.fail} failed</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{summary.warn} with warnings</strong>. Average duration{" "}
            <strong>{summary.avgDurSec}s</strong>.
          </>
        }
        actions={
          <SearchField value={search} onChange={setSearch} placeholder="Filter runs…" />
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Runs · 24h" value={summary.runs24h} hint={`${summary.success} successful`} tone="pos" />
        <KPI
          label="Success rate"
          value={summary.runs24h ? `${Math.round((summary.success / summary.runs24h) * 100)}%` : "—"}
          tone={summary.fail === 0 ? "pos" : "warn"}
        />
        <KPI label="Failed" value={summary.fail} tone={summary.fail > 0 ? "neg" : undefined} />
        <KPI label="With warnings" value={summary.warn} tone={summary.warn > 0 ? "warn" : undefined} />
        <KPI label="Avg duration" value={`${summary.avgDurSec}s`} tone="pos" />
      </div>

      {failedRun && (
        <div className="mn-narrative" style={{ marginBottom: 18 }}>
          <div className="ico"><SparklesIcon size={15} /></div>
          <div style={{ flex: 1 }}>
            <div className="mn-narrative-headline">
              {failedRun.systemName} run failed at {timeOnly(failedRun.run.started_at)}.
            </div>
            <div className="mn-narrative-detail">
              {failedRun.run.error_detail ?? "Check the run detail for more context."}
            </div>
          </div>
          <button
            type="button"
            className="mn-btn mn-btn-ghost"
            style={{ background: "white" }}
            onClick={() => copyToClipboard(failedRun.run.id, "Failed run ID copied")}
          >
            Copy run ID <ArrowRight size={13} />
          </button>
        </div>
      )}

      <SectionHeader
        title="Recent runs"
        caption={
          search.trim()
            ? `${merged.filter((m) => matchesSearch(m, search)).length} of ${merged.length} runs match`
            : `Last ${merged.length} sync events · most recent first`
        }
      />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Time</th>
                <th>System</th>
                <th>Status</th>
                <th className="right">Rows extracted</th>
                <th className="right">Findings Δ</th>
                <th className="right">Duration</th>
                <th>Note</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {merged.filter((m) => matchesSearch(m, search)).map(({ run, systemName }) => {
                const s = mapStatus(run);
                const t = SM_STATUS[s];
                const dur = durationSec(run);
                return (
                  <tr key={run.id}>
                    <td style={{ paddingLeft: 20 }} className="mn-tabular">
                      <span style={{ font: "600 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-700)" }}>
                        {timeOnly(run.started_at)}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)" }}>{systemName}</div>
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: t.bg,
                          color: t.fg,
                          font: "700 10px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.1em",
                        }}
                      >
                        {t.l}
                      </span>
                    </td>
                    <td className="right mn-tabular" style={{ color: run.rows_extracted > 0 ? "var(--mn-ink-700)" : "var(--mn-ink-300)" }}>
                      {run.rows_extracted > 0 ? run.rows_extracted.toLocaleString() : "—"}
                    </td>
                    <td className="right mn-tabular" style={{ color: run.findings_delta > 0 ? "var(--mn-warn)" : "var(--mn-ink-500)" }}>
                      {run.findings_delta}
                    </td>
                    <td className="right">
                      <span
                        className="mn-tabular"
                        style={{
                          font: "500 12px/1 'JetBrains Mono', monospace",
                          color: dur > 60 ? "var(--mn-warn)" : "var(--mn-ink-500)",
                        }}
                      >
                        {dur}s
                      </span>
                    </td>
                    <td style={{ color: s === "fail" ? "var(--mn-neg)" : "var(--mn-ink-500)", fontSize: 12.5 }}>
                      {run.error_detail ?? "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mn-icon-btn"
                        style={{ width: 26, height: 26 }}
                        aria-label="Copy run ID"
                        onClick={() => copyToClipboard(run.id, "Run ID copied")}
                      >
                        <MoreH size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {merged.filter((m) => matchesSearch(m, search)).length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    {merged.length === 0 ? "No sync runs recorded yet." : "No runs match this filter."}
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
