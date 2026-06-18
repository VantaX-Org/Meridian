"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader, StatusDot, ModChip } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getMasterRecords } from "@/lib/api/master-records";
import { downloadCsv } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { MasterRecordStatus, MasterRecordSummary } from "@/types/api";

const KIND_LABELS: Record<string, { bg: string; fg: string; l: string }> = {
  vendor:   { bg: "var(--mn-primary-50)",   fg: "var(--mn-primary-700)", l: "VENDOR" },
  customer: { bg: "rgba(124,58,237,0.12)",  fg: "#7C3AED",               l: "CUSTOMER" },
  material: { bg: "rgba(14,165,164,0.12)",  fg: "#0EA5A4",               l: "MATERIAL" },
  employee: { bg: "var(--mn-warn-bg)",      fg: "var(--mn-warn)",        l: "EMPLOYEE" },
};

function KindChip({ domain }: { domain: string }) {
  const key = domain.toLowerCase();
  const t = KIND_LABELS[key] ?? { bg: "rgba(15,23,42,0.06)", fg: "var(--mn-ink-500)", l: domain.toUpperCase() };
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "3px 7px",
        borderRadius: 4,
        background: t.bg,
        color: t.fg,
        font: "700 10px/1 'JetBrains Mono', monospace",
        letterSpacing: "0.08em",
      }}
    >
      {t.l}
    </span>
  );
}

function StatusForRecord({ s }: { s: MasterRecordStatus }) {
  if (s === "golden") return <StatusDot status="healthy" />;
  if (s === "pending_review") return <StatusDot status="in-review" />;
  if (s === "candidate") return <StatusDot status="open" />;
  return <StatusDot status="scheduled" />;
}

export default function GoldenRecordsPage() {
  const [domainFilter, setDomainFilter] = useState<"all" | string>("all");
  const { data, isLoading, error } = useQuery({
    queryKey: ["master-records.list", { domain: domainFilter }],
    queryFn: () =>
      getMasterRecords({
        per_page: 100,
        domain: domainFilter === "all" ? undefined : domainFilter,
      }),
  });

  const records: MasterRecordSummary[] = data?.records ?? [];
  const total = data?.total ?? records.length;

  const byKind = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of records) counts[r.domain] = (counts[r.domain] ?? 0) + 1;
    return counts;
  }, [records]);

  const golden = records.filter((r) => r.status === "golden").length;
  const pending = records.filter((r) => r.status === "pending_review").length;
  const conflicts = records.reduce((a, r) => a + r.pending_issues, 0);

  const meanConfidence = records.length
    ? Math.round(
        (records.reduce((a, r) => a + r.overall_confidence, 0) / records.length) * 100,
      )
    : null;

  if (isLoading) {
    return (
      <>
        <PageHead title="Golden Records" route="Govern · /golden-records" sub="Loading master records…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Golden Records" route="Govern · /golden-records" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/master-records</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Golden Records"
        route="Govern · /golden-records"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{total.toLocaleString()} master records</strong> across the estate ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{golden} golden</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{pending} pending review</strong>,{" "}
            <strong style={{ color: "var(--mn-neg)" }}>{conflicts} open issues</strong>.
          </>
        }
        actions={
          <button
            type="button"
            className="mn-btn mn-btn-ghost"
            onClick={() =>
              downloadCsv(
                "meridian-golden-records.csv",
                records.map((r) => ({
                  id: r.id,
                  domain: r.domain,
                  sap_key: r.sap_object_key,
                  sources: r.source_count,
                  confidence: Math.round(r.overall_confidence * 100) + "%",
                  issues: r.pending_issues,
                  status: r.status,
                  updated_at: r.updated_at,
                })),
              )
            }
          >
            Export
          </button>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Golden" value={golden} hint={`${total - golden} non-golden`} tone="pos" />
        <KPI label="Pending review" value={pending} tone="warn" />
        <KPI label="Open issues" value={conflicts} tone={conflicts > 0 ? "neg" : "pos"} />
        <KPI label="Domains" value={Object.keys(byKind).length} />
        <KPI label="Mean confidence" value={meanConfidence !== null ? `${meanConfidence}%` : "—"} tone="pos" />
      </div>

      <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
        <div className="mn-col-8">
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Coverage by domain" caption="Share of master records by domain" />
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {Object.entries(byKind).map(([k, v]) => {
                const pct = (v / Math.max(total, 1)) * 100;
                const fg = KIND_LABELS[k.toLowerCase()]?.fg ?? "var(--mn-primary)";
                return (
                  <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr 120px", alignItems: "center", gap: 14 }}>
                    <KindChip domain={k} />
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 8, background: "rgba(15,23,42,0.05)", borderRadius: 4, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: fg,
                            borderRadius: 4,
                            transition: "width 900ms cubic-bezier(.2,.7,.2,1)",
                          }}
                        />
                      </div>
                      <span className="mn-tabular" style={{ fontSize: 11.5, color: "var(--mn-ink-400)", minWidth: 45, textAlign: "right" }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <span className="mn-tabular" style={{ font: "600 14px/1 'Inter Tight'", color: "var(--mn-ink-900)", textAlign: "right" }}>
                      {v.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Confidence" caption="Mean across all surfaced records" />
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
              <span className="mn-tabular" style={{ font: "600 36px/1 'Inter Tight'", letterSpacing: "-0.025em" }}>
                {meanConfidence !== null ? meanConfidence : "—"}
              </span>
              <span style={{ font: "500 14px/1 'Inter Tight'", color: "var(--mn-ink-300)" }}>%</span>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--mn-ink-500)" }}>
              Higher confidence reflects strong cross-source agreement on golden fields.
            </div>
          </div>
        </div>
      </div>

      <div className="mn-segment" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button type="button" className={domainFilter === "all" ? "on" : ""} onClick={() => setDomainFilter("all")}>
          All <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>{total}</span>
        </button>
        {Object.entries(byKind).map(([k, v]) => (
          <button key={k} type="button" className={domainFilter === k ? "on" : ""} onClick={() => setDomainFilter(k)}>
            {k} <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>{v}</span>
          </button>
        ))}
      </div>

      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>ID</th>
                <th>Kind</th>
                <th>SAP key</th>
                <th className="right">Sources</th>
                <th>Confidence</th>
                <th>Issues</th>
                <th>Updated</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingLeft: 20 }} className="mn-tabular">
                    <Link
                      href={`/golden-records/${r.id}`}
                      style={{
                        font: "600 11.5px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-primary-700)",
                      }}
                    >
                      {r.id.slice(0, 10)}
                    </Link>
                  </td>
                  <td><KindChip domain={r.domain} /></td>
                  <td>
                    <ModChip>{r.sap_object_key}</ModChip>
                  </td>
                  <td className="right mn-tabular">{r.source_count}</td>
                  <td>
                    <span
                      className="mn-tabular"
                      style={{ color: r.overall_confidence >= 0.9 ? "var(--mn-pos)" : r.overall_confidence >= 0.8 ? "var(--mn-primary)" : "var(--mn-warn)" }}
                    >
                      {Math.round(r.overall_confidence * 100)}%
                    </span>
                  </td>
                  <td>
                    {r.pending_issues > 0 ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "3px 7px",
                          borderRadius: 4,
                          background: "var(--mn-neg-bg)",
                          color: "var(--mn-neg)",
                          font: "600 11.5px/1 'Inter'",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        ⚠ {r.pending_issues}
                      </span>
                    ) : (
                      <span style={{ color: "var(--mn-ink-300)" }}>—</span>
                    )}
                  </td>
                  <td className="mn-tabular" style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                    {relativeTime(r.updated_at)}
                  </td>
                  <td><StatusForRecord s={r.status} /></td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    No master records yet.
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
