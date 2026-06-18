"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI } from "@/components/meridian/atoms";
import { ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EMPTY_MINING_SUMMARY,
  getMiningPatterns,
  getMiningSummary,
  isMiningAvailable,
  type MiningPattern,
} from "@/lib/api/mining";
import { copyToClipboard } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import { relativeTime } from "@/lib/format";

const SEV_TONE: Record<MiningPattern["severity"], { bg: string; fg: string; l: string }> = {
  critical: { bg: "var(--mn-neg-bg)",     fg: "var(--mn-neg)",  l: "CRITICAL" },
  high:     { bg: "var(--mn-warn-bg)",    fg: "var(--mn-warn)", l: "HIGH" },
  medium:   { bg: "var(--mn-primary-50)", fg: "var(--mn-primary-700)", l: "MEDIUM" },
  low:      { bg: "rgba(15,23,42,0.06)",  fg: "var(--mn-ink-500)", l: "LOW" },
};

const PATTERN_LABEL: Record<string, string> = {
  drift: "DRIFT",
  anomaly: "ANOMALY",
  pii: "PII",
  dup: "DUPLICATE",
  duplicate: "DUPLICATE",
};

export default function MiningPage() {
  const [filter, setFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");

  const summaryQ = useQuery({
    queryKey: ["mining.summary"],
    queryFn: () => getMiningSummary(30),
  });
  const patternsQ = useQuery({
    queryKey: ["mining.patterns", { filter }],
    queryFn: () =>
      getMiningPatterns({
        pattern_type: filter === "all" ? undefined : filter,
        limit: 100,
      }),
  });

  if (summaryQ.isLoading || patternsQ.isLoading) {
    return (
      <>
        <PageHead title="Mining" route="Analyse · /mining" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }

  if (summaryQ.error || patternsQ.error) {
    return (
      <>
        <PageHead title="Mining" route="Analyse · /mining" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/mining/*</code>.
        </div>
      </>
    );
  }

  const summary = summaryQ.data ?? EMPTY_MINING_SUMMARY;
  const patterns = patternsQ.data?.patterns ?? [];
  const filtered = patterns.filter((p) => matchesSearch(p, search));
  const available = isMiningAvailable(summary);

  return (
    <>
      <PageHead
        title="Mining"
        route="Analyse · /mining"
        sub={
          available
            ? (
              <>
                <strong style={{ color: "var(--mn-ink-700)" }}>{summary.total_patterns}</strong> patterns over the last{" "}
                {summary.window_days} days · <strong style={{ color: "var(--mn-warn)" }}>{summary.new_anomalies} new anomalies</strong>.
              </>
            )
            : "Mining is not yet enabled on this deployment."
        }
        actions={
          <SearchField value={search} onChange={setSearch} placeholder="Filter patterns…" />
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Patterns" value={summary.total_patterns} />
        <KPI label="New anomalies · 30d" value={summary.new_anomalies} tone="warn" />
        <KPI label="Stable patterns" value={summary.stable_patterns} tone="pos" />
        <KPI label="Coverage" value={`${Math.round(summary.coverage_pct)}%`} />
        <KPI label="Runs · all-time" value={summary.runs_total} />
      </div>

      <div className="mn-segment" style={{ marginBottom: 12 }}>
        {(["all", "anomaly", "drift", "duplicate", "pii"]).map((k) => (
          <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : (PATTERN_LABEL[k] ?? k.toUpperCase())}
          </button>
        ))}
      </div>

      <div className="mn-insight-list">
        {filtered.map((p) => {
          const t = SEV_TONE[p.severity];
          return (
            <div key={p.id} className="mn-insight">
              <div className="mn-insight-stripe" style={{ background: t.fg }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mn-insight-head">
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "3px 8px",
                      borderRadius: 4,
                      background: "var(--mn-primary-50)",
                      color: "var(--mn-primary-700)",
                      font: "700 10px/1 'JetBrains Mono', monospace",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {PATTERN_LABEL[p.pattern_type] ?? p.pattern_type.toUpperCase()}
                  </span>
                  <span
                    className="mn-tabular"
                    style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                  >
                    {p.id.slice(0, 8)}
                  </span>
                  <span
                    style={{
                      font: "500 11.5px/1 'JetBrains Mono', monospace",
                      color: t.fg,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {t.l}
                  </span>
                  <span style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}>
                    confidence {Math.round(p.confidence * 100)}%
                  </span>
                </div>
                <div className="mn-insight-title">{p.name}</div>
                <div className="mn-insight-target">
                  <span
                    className="mn-tabular"
                    style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                  >
                    {p.module} · {p.occurrences} occurrences · last seen {relativeTime(p.last_seen)}
                  </span>
                </div>
              </div>
              <div className="mn-insight-actions">
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => copyToClipboard(p.id, "Pattern ID copied")}
                >
                  Copy ID <ArrowRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
            No patterns match this filter.
          </div>
        )}
      </div>
    </>
  );
}
