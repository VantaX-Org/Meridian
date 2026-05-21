"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, ModChip } from "@/components/meridian/atoms";
import { ArrowRight, MoreH, SparklesIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getVersions } from "@/lib/api/versions";
import { getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { downloadAuthenticated } from "@/lib/api/download";
import { copyToClipboard } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { DQSSummary, Version } from "@/types/api";

type ExportType = "PDF" | "JSON" | "XLSX";

const TYPE_COLORS: Record<ExportType, { bg: string; fg: string }> = {
  PDF:  { bg: "var(--mn-neg-bg)",     fg: "var(--mn-neg)" },
  XLSX: { bg: "var(--mn-pos-bg)",     fg: "var(--mn-pos)" },
  JSON: { bg: "var(--mn-primary-50)", fg: "var(--mn-primary-700)" },
};

function averageDqs(summary: Record<string, DQSSummary> | null): number | null {
  if (!summary) return null;
  const scores = Object.values(summary).map((m) => m.composite_score);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function totalRecords(summary: Record<string, DQSSummary> | null): number {
  if (!summary) return 0;
  return Object.values(summary).reduce((a, m) => a + (m.total_checks ?? 0), 0);
}

function isCompleteForExport(v: Version): boolean {
  return (
    (v.status === "agents_complete" || v.status === "ai_enriched" || v.status === "complete") &&
    !!v.dqs_summary
  );
}

export default function ReportsPage() {
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reports.versions", { limit: 50 }],
    queryFn: () => getVersions({ limit: 50 }),
  });

  const versions: Version[] = useMemo(() => data?.versions ?? [], [data]);
  const exportable = useMemo(() => versions.filter(isCompleteForExport), [versions]);
  const active = exportable.find((v) => v.id === activeId) ?? exportable[0];

  const downloadPdf = async (versionId: string) => {
    try {
      await downloadAuthenticated(getReportDownloadUrl(versionId), `meridian_dq_report_${versionId}.pdf`);
      toast.success("PDF report downloaded");
    } catch {
      toast.error("Failed to download PDF report");
    }
  };
  const downloadJson = async (versionId: string) => {
    try {
      await downloadAuthenticated(getReportJsonExportUrl(versionId), `meridian_dq_report_${versionId}.json`);
      toast.success("JSON report downloaded");
    } catch {
      toast.error("Failed to download JSON report");
    }
  };
  const downloadConfigMatches = async (versionId: string) => {
    try {
      await downloadAuthenticated(
        getConfigMatchesExportUrl(versionId),
        `meridian-config-${versionId.slice(0, 8)}.xlsx`,
      );
      toast.success("Config matches downloaded");
    } catch {
      toast.error("Failed to download config matches");
    }
  };

  if (isLoading) {
    return (
      <>
        <PageHead title="Reports" route="Report · /reports" sub="Loading reports…" />
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 18 }}>
          {Array.from({ length: 4 }).map((_, i) => (
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
        <PageHead title="Reports" route="Report · /reports" sub="Failed to load reports." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/versions</code>.
        </div>
      </>
    );
  }

  const total = exportable.length;
  const last7 = exportable.filter(
    (v) => Date.now() - new Date(v.run_at).getTime() < 7 * 86400 * 1000,
  ).length;
  const last30 = exportable.filter(
    (v) => Date.now() - new Date(v.run_at).getTime() < 30 * 86400 * 1000,
  ).length;

  return (
    <>
      <PageHead
        title="Reports"
        route="Report · /reports"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} reports</strong> available ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{last7} this week</strong>,{" "}
            <strong style={{ color: "var(--mn-primary-700)" }}>{last30} this month</strong>.
            {active?.label && (
              <>
                {" "}Latest: <strong style={{ color: "var(--mn-ink-700)" }}>{active.label}</strong>.
              </>
            )}
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Total reports" value={total} hint={`${last7} this week`} />
        <KPI label="This month" value={last30} tone="pos" />
        <KPI label="Latest" value={active ? new Date(active.run_at).toLocaleDateString() : "—"} />
        <KPI label="Latest DQS" value={active ? averageDqs(active.dqs_summary)?.toFixed(1) ?? "—" : "—"} tone="pos" />
      </div>

      {active && (
        <div className="mn-narrative" style={{ marginBottom: 18 }}>
          <div className="ico"><SparklesIcon size={15} /></div>
          <div style={{ flex: 1 }}>
            <div className="mn-narrative-headline">
              Latest report ready — {active.label ?? "Unlabelled run"} · DQS{" "}
              {averageDqs(active.dqs_summary)?.toFixed(1) ?? "—"}.
            </div>
            <div className="mn-narrative-detail">
              {totalRecords(active.dqs_summary).toLocaleString()} records analysed ·{" "}
              {Object.keys(active.dqs_summary ?? {}).length} modules
            </div>
          </div>
          <button
            type="button"
            className="mn-btn mn-btn-primary"
            onClick={() => downloadPdf(active.id)}
          >
            Download PDF
          </button>
        </div>
      )}

      <div className="mn-row mn-row-12">
        <div className="mn-col-8">
          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="mn-report-list">
              {exportable.map((v) => {
                const dqs = averageDqs(v.dqs_summary);
                return (
                  <div
                    key={v.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={v.id === active?.id}
                    className={`mn-report-row ${v.id === active?.id ? "active" : ""}`}
                    onClick={() => setActiveId(v.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveId(v.id);
                      }
                    }}
                  >
                    <span
                      className="mn-report-type"
                      style={{ background: TYPE_COLORS.PDF.bg, color: TYPE_COLORS.PDF.fg }}
                    >
                      PDF
                    </span>
                    <div className="mn-report-meta">
                      <div className="mn-report-title">{v.label ?? "Unlabelled run"}</div>
                      <div className="mn-report-sub">
                        <span className="mn-tabular">{v.id.slice(0, 8)}</span>
                        <span className="dot">·</span>
                        <span>{Object.keys(v.dqs_summary ?? {}).length} modules</span>
                        <span className="dot">·</span>
                        <span className="mn-tabular">{relativeTime(v.run_at)}</span>
                      </div>
                    </div>
                    <div className="mn-report-stats">
                      <div>
                        <span className="mn-eyebrow">Records</span>
                        <span className="v mn-tabular">{totalRecords(v.dqs_summary).toLocaleString()}</span>
                      </div>
                      {dqs !== null && (
                        <div>
                          <span className="mn-eyebrow">DQS</span>
                          <span className="v mn-tabular">{dqs.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="mn-icon-btn"
                      style={{ width: 30, height: 30 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadPdf(v.id);
                      }}
                      aria-label="Download PDF"
                    >
                      ↓
                    </button>
                  </div>
                );
              })}
              {exportable.length === 0 && (
                <div style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                  No exportable reports yet. Reports become available once a version completes.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="mn-eyebrow">Preview · {active?.id.slice(0, 8) ?? "—"}</span>
              <button
                type="button"
                className="mn-icon-btn"
                style={{ width: 28, height: 28 }}
                aria-label="Copy version ID"
                onClick={() => active && copyToClipboard(active.id, "Version ID copied")}
              >
                <MoreH size={14} />
              </button>
            </div>

            {active ? (
              <>
                <div className="mn-report-preview">
                  <div className="mn-report-page">
                    <div className="page-h">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <ModChip>AUDIT</ModChip>
                        <span
                          className="mn-tabular"
                          style={{ font: "500 9px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-300)" }}
                        >
                          {active.id.slice(0, 6)}
                        </span>
                      </div>
                      <div className="page-title">{active.label ?? "Unlabelled run"}</div>
                      <div className="page-meta">{relativeTime(active.run_at)}</div>
                    </div>
                    <div className="page-body">
                      {averageDqs(active.dqs_summary) !== null && (
                        <div className="page-stat">
                          <span className="mn-eyebrow">DQS</span>
                          <span className="page-stat-v mn-tabular">
                            {averageDqs(active.dqs_summary)?.toFixed(1)}
                          </span>
                        </div>
                      )}
                      <div style={{ height: 32, margin: "10px 0", borderRadius: 4, background: "var(--mn-primary-50)" }} />
                      <div style={{ height: 4, background: "var(--mn-line-2)", borderRadius: 999, margin: "8px 0" }} />
                      <div style={{ height: 4, background: "var(--mn-line-2)", borderRadius: 999, margin: "8px 0", width: "80%" }} />
                      <div style={{ height: 4, background: "var(--mn-line-2)", borderRadius: 999, margin: "8px 0", width: "60%" }} />
                    </div>
                  </div>
                </div>

                <div className="mn-detail-section">
                  <div className="mn-eyebrow">Details</div>
                  <div className="mn-detail-meta">
                    <div><span className="k">Version</span><span className="v mn-tabular">{active.id.slice(0, 8)}</span></div>
                    <div><span className="k">Run</span><span className="v mn-tabular">{new Date(active.run_at).toLocaleString()}</span></div>
                    <div><span className="k">Modules</span><span className="v mn-tabular">{Object.keys(active.dqs_summary ?? {}).length}</span></div>
                    <div><span className="k">Records</span><span className="v mn-tabular">{totalRecords(active.dqs_summary).toLocaleString()}</span></div>
                  </div>
                </div>

                <div className="mn-detail-actions">
                  <button
                    type="button"
                    className="mn-btn mn-btn-primary"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => downloadPdf(active.id)}
                  >
                    PDF <ArrowRight size={13} />
                  </button>
                  <button type="button" className="mn-btn mn-btn-ghost" onClick={() => downloadJson(active.id)}>
                    JSON
                  </button>
                  <button type="button" className="mn-btn mn-btn-ghost" onClick={() => downloadConfigMatches(active.id)}>
                    Config XLSX
                  </button>
                </div>
              </>
            ) : (
              <p style={{ color: "var(--mn-ink-400)", marginTop: 12 }}>
                No completed report selected.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
