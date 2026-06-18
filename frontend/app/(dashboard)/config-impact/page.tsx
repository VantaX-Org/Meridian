"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, ModChip } from "@/components/meridian/atoms";
import { MoreH } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getVersions } from "@/lib/api/versions";
import { copyToClipboard } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import type { ConfigImpactResult, Version } from "@/types/api";

const STATUS_TONE: Record<ConfigImpactResult["status"], { bg: string; fg: string; l: string }> = {
  blocked:  { bg: "var(--mn-neg-bg)",     fg: "var(--mn-neg)",  l: "BLOCKED" },
  degraded: { bg: "var(--mn-warn-bg)",    fg: "var(--mn-warn)", l: "DEGRADED" },
  ok:       { bg: "var(--mn-pos-bg)",     fg: "var(--mn-pos)",  l: "OK" },
};

function isCompleteVersion(v: Version): boolean {
  return (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;
}

export default function ConfigImpactPage() {
  const [search, setSearch] = useState("");
  const versionsQ = useQuery({
    queryKey: ["versions.list", { limit: 1 }],
    queryFn: () => getVersions({ limit: 10 }),
  });

  const latest = useMemo(
    () => versionsQ.data?.versions.find(isCompleteVersion),
    [versionsQ.data],
  );

  const impactQ = useQuery({
    queryKey: ["config-impact", latest?.id],
    queryFn: () => getConfigImpact(latest!.id),
    enabled: !!latest,
  });

  if (versionsQ.isLoading || (latest && impactQ.isLoading)) {
    return (
      <>
        <PageHead title="Config Impact" route="Connect · /config-impact" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }

  if (!latest) {
    return (
      <>
        <PageHead
          title="Config Impact"
          route="Connect · /config-impact"
          sub="Config impact analysis runs against a completed version. None available yet."
        />
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
          Run an analysis from <code>/run-sync</code> to populate config impact.
        </div>
      </>
    );
  }

  if (versionsQ.error || impactQ.error) {
    return (
      <>
        <PageHead title="Config Impact" route="Connect · /config-impact" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/config-impact/{"{versionId}"}</code>.
        </div>
      </>
    );
  }

  const results = impactQ.data?.results ?? [];
  const summary = impactQ.data?.summary ?? {
    total_features_assessed: 0,
    features_blocked: 0,
    features_degraded: 0,
    features_ok: 0,
    top_blocked_features: [] as string[],
  };

  return (
    <>
      <PageHead
        title="Config Impact"
        route="Connect · /config-impact"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{summary.total_features_assessed}</strong> features assessed against version{" "}
            <span style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>{latest.id.slice(0, 8)}</span>{" "}
            ({latest.label ?? "Unlabelled run"}).
          </>
        }
        actions={
          <SearchField value={search} onChange={setSearch} placeholder="Filter features…" />
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Features assessed" value={summary.total_features_assessed} />
        <KPI label="Blocked" value={summary.features_blocked} tone="neg" />
        <KPI label="Degraded" value={summary.features_degraded} tone="warn" />
        <KPI label="OK" value={summary.features_ok} tone="pos" />
      </div>

      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Feature</th>
                <th>System</th>
                <th>Status</th>
                <th className="right">Blocking</th>
                <th className="right">Records</th>
                <th>Opportunity</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {results.filter((r) => matchesSearch(r, search)).map((r, i) => {
                const st = STATUS_TONE[r.status];
                return (
                  <tr key={`${r.feature}-${i}`}>
                    <td style={{ paddingLeft: 20 }}>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)", fontSize: 13 }}>{r.feature}</div>
                      {r.blocked_transactions.length > 0 && (
                        <div
                          style={{
                            font: "500 11px/1 'JetBrains Mono', monospace",
                            color: "var(--mn-ink-400)",
                            marginTop: 3,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {r.blocked_transactions.slice(0, 3).join(" · ")}
                          {r.blocked_transactions.length > 3 ? ` +${r.blocked_transactions.length - 3}` : ""}
                        </div>
                      )}
                    </td>
                    <td><ModChip>{r.system}</ModChip></td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: st.bg,
                          color: st.fg,
                          font: "700 9.5px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.1em",
                        }}
                      >
                        {st.l}
                      </span>
                    </td>
                    <td className="right mn-tabular">{r.blocking_findings.length}</td>
                    <td className="right mn-tabular">{r.total_affected_records.toLocaleString()}</td>
                    <td style={{ fontSize: 12.5, color: "var(--mn-ink-500)" }}>{r.opportunity_cost_summary}</td>
                    <td>
                      <button
                        type="button"
                        className="mn-icon-btn"
                        style={{ width: 26, height: 26 }}
                        aria-label="Copy feature name"
                        onClick={() => copyToClipboard(r.feature, "Feature name copied")}
                      >
                        <MoreH size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {results.filter((r) => matchesSearch(r, search)).length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    {results.length === 0
                      ? "No config impact results yet for this version."
                      : "No features match this filter."}
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
