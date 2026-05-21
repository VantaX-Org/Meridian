"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PageHead,
  KPI,
  SectionHeader,
  DeltaPill,
  SevTag,
  StatusDot,
  ModChip,
} from "@/components/meridian/atoms";
import {
  BookmarkIcon,
  MoreH,
} from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getFindings } from "@/lib/api/findings";
import { copyToClipboard, saveView } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import type { Finding, Severity } from "@/types/api";

type SevKey = "critical" | "high" | "medium" | "low";
type Status = "open" | "in-review" | "resolved";

/* ── Helpers ────────────────────────────────────────────────────── */

function ageString(iso: string): string {
  const t = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(t / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function mapSeverity(s: Severity): SevKey {
  switch (s) {
    case "critical": return "critical";
    case "high":     return "high";
    case "medium":   return "medium";
    case "low":      return "low";
    default:         return "medium";
  }
}

function deriveStatus(_f: Finding): Status {
  // Backend doesn't return a workflow status today — every finding from
  // /api/v1/findings is currently "open". When the backend adds a status
  // column this should switch to read it directly.
  return "open";
}

function ruleLabel(f: Finding): string {
  return f.check_id;
}

/* ── Facet sidebar ──────────────────────────────────────────────── */

function Facet({
  title,
  items,
  activeKey,
  onClick,
}: {
  title: string;
  items: { k: string; n: number }[];
  activeKey: string | null;
  onClick?: (k: string | null) => void;
}) {
  const max = Math.max(...items.map((i) => i.n), 1);
  return (
    <div className="mn-facet">
      <div className="mn-facet-title">{title}</div>
      {items.map((it) => {
        const active = it.k === activeKey;
        return (
          <button
            key={it.k}
            type="button"
            className={`mn-facet-row ${active ? "active" : ""}`}
            onClick={() => onClick?.(active ? null : it.k)}
          >
            <span className="mn-facet-key">{it.k}</span>
            <span className="mn-facet-bar">
              <span className="fill" style={{ width: `${(it.n / max) * 100}%` }} />
            </span>
            <span className="mn-facet-count mn-tabular">{it.n.toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Severity stacked bar ───────────────────────────────────────── */

function SeverityStack({
  counts,
  total,
}: {
  counts: { critical: number; high: number; medium: number; low: number };
  total: number;
}) {
  const rows: { k: SevKey; v: number; c: string }[] = [
    { k: "critical", v: counts.critical, c: "var(--mn-neg)" },
    { k: "high", v: counts.high, c: "var(--mn-warn)" },
    { k: "medium", v: counts.medium, c: "var(--mn-primary)" },
    { k: "low", v: counts.low, c: "#0EA5A4" },
  ];
  return (
    <div className="mn-sev-stack">
      <div className="mn-sev-stack-bar">
        {rows.map((r) => (
          <div
            key={r.k}
            className="seg"
            style={{ width: `${(r.v / Math.max(total, 1)) * 100}%`, background: r.c }}
            title={`${r.k}: ${r.v}`}
          />
        ))}
      </div>
      <div className="mn-sev-stack-legend">
        {rows.map((r) => (
          <div key={r.k} className="leg">
            <span className="dot" style={{ background: r.c }} />
            <span className="lbl">{r.k}</span>
            <span className="num mn-tabular">{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function FindingsPage() {
  const [sevFilter, setSevFilter] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Scope to one import when arriving from /upload (?version_id=…). Read from
  // the URL on mount — mirrors the window.location pattern used elsewhere and
  // avoids the useSearchParams Suspense requirement.
  const [versionId, setVersionId] = useState<string | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("version_id");
    if (v) setVersionId(v);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["findings.list", { sev: sevFilter, module: moduleFilter, version: versionId }],
    queryFn: () => getFindings({
      limit: 200,
      severity: sevFilter ?? undefined,
      module: moduleFilter ?? undefined,
      version_id: versionId ?? undefined,
    }),
  });

  const findings: Finding[] = data?.findings ?? [];
  const visibleFindings = findings.filter((f) => matchesSearch(f, search));
  const total = data?.total ?? findings.length;

  // Effective selected finding (defaults to the first row).
  const selected = selectedId
    ? findings.find((f) => f.id === selectedId) ?? findings[0]
    : findings[0];

  // Derive facets from the returned set (with current filters applied).
  const facets = useMemo(() => {
    const sev: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const mod: Record<string, number> = {};
    for (const f of findings) {
      const k = mapSeverity(f.severity);
      sev[k] = (sev[k] ?? 0) + 1;
      mod[f.module] = (mod[f.module] ?? 0) + 1;
    }
    return {
      severity: (Object.entries(sev) as [SevKey, number][]).map(([k, n]) => ({ k, n })),
      module: Object.entries(mod)
        .map(([k, n]) => ({ k, n }))
        .sort((a, b) => b.n - a.n),
    };
  }, [findings]);

  const counts = {
    critical: facets.severity.find((s) => s.k === "critical")?.n ?? 0,
    high: facets.severity.find((s) => s.k === "high")?.n ?? 0,
    medium: facets.severity.find((s) => s.k === "medium")?.n ?? 0,
    low: facets.severity.find((s) => s.k === "low")?.n ?? 0,
  };

  if (isLoading) {
    return (
      <>
        <PageHead title="Findings" route="Analyse · /findings" sub="Loading findings…" />
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(6, 1fr)", marginBottom: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => (
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
        <PageHead title="Findings" route="Analyse · /findings" sub="Failed to load findings." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/findings</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Findings"
        route="Analyse · /findings"
        sub={
          <>
            <strong style={{ color: "var(--mn-neg)" }}>{counts.critical} critical</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{counts.high} high</strong>, and{" "}
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} open</strong> findings across the estate.
          </>
        }
        actions={
          <>
            <span className="mn-pill"><span className="pdot" />Live triage</span>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() => saveView("findings", { sev: sevFilter, module: moduleFilter })}
            >
              <BookmarkIcon /> Save view
            </button>
            <Link href="/settings/rules" className="mn-btn mn-btn-primary">New rule</Link>
          </>
        }
      />

      {/* Stat rail */}
      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))", marginBottom: 14 }}>
        <KPI label="Open" value={total} />
        <KPI label="Critical" value={counts.critical} tone="neg" />
        <KPI label="High" value={counts.high} tone="warn" />
        <KPI label="Medium" value={counts.medium} tone="warn" />
        <KPI label="Low" value={counts.low} />
        <KPI label="Modules affected" value={facets.module.length} />
      </div>

      {/* Hero — severity stack */}
      <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
        <div className="mn-col-8">
          <div className="mn-card mn-card-pad">
            <SectionHeader
              title="Findings by gravity"
              caption={`${total} total · derived from /api/v1/findings`}
            />
            <div style={{ marginTop: 18 }}>
              <SeverityStack counts={counts} total={total} />
            </div>
          </div>
        </div>
        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Records affected" caption="Across all findings" />
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
              <span className="mn-tabular" style={{ font: "600 30px/1 'Inter Tight'", letterSpacing: "-0.02em" }}>
                {findings.reduce((a, f) => a + f.affected_count, 0).toLocaleString()}
              </span>
              <DeltaPill delta={null} unit="" />
              <span style={{ fontSize: 12, color: "var(--mn-ink-400)", marginLeft: "auto" }}>open</span>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--mn-ink-500)" }}>
              Mean pass-rate:{" "}
              {findings.length === 0
                ? "—"
                : `${Math.round(
                    findings.reduce((a, f) => a + (f.pass_rate ?? 0), 0) / findings.length,
                  )}%`}
            </div>
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mn-findings-layout">
        <div className="mn-findings-filter">
          <div className="mn-chip-row">
            {versionId && (
              <button type="button" className="mn-active-chip" onClick={() => setVersionId(null)}>
                import · {versionId.slice(0, 8)} ×
              </button>
            )}
            {sevFilter && (
              <button type="button" className="mn-active-chip" onClick={() => setSevFilter(null)}>
                severity · {sevFilter} ×
              </button>
            )}
            {moduleFilter && (
              <button type="button" className="mn-active-chip" onClick={() => setModuleFilter(null)}>
                module · {moduleFilter} ×
              </button>
            )}
            {(sevFilter || moduleFilter || versionId) && (
              <button
                type="button"
                className="mn-link"
                onClick={() => {
                  setSevFilter(null);
                  setModuleFilter(null);
                  setVersionId(null);
                }}
              >
                Clear all
              </button>
            )}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}>
              {visibleFindings.length} of {total}
            </span>
            <SearchField value={search} onChange={setSearch} placeholder="Filter findings…" />
          </div>
        </div>

        <div className="mn-findings-grid">
          <aside className="mn-facets">
            <Facet title="Severity" items={facets.severity} activeKey={sevFilter} onClick={setSevFilter} />
            <Facet title="Module" items={facets.module} activeKey={moduleFilter} onClick={setModuleFilter} />
          </aside>

          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="mn-table-wrap">
              <table className="mn-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Severity</th>
                    <th>ID</th>
                    <th>Finding</th>
                    <th>Module</th>
                    <th>Rule</th>
                    <th className="right">Records</th>
                    <th>Age</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleFindings.map((f) => (
                    <tr
                      key={f.id}
                      className={selected?.id === f.id ? "selected" : ""}
                      onClick={() => setSelectedId(f.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ paddingLeft: 20 }}>
                        <SevTag sev={mapSeverity(f.severity)} />
                      </td>
                      <td
                        className="mn-tabular"
                        style={{ font: "600 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {f.id.slice(0, 8)}
                      </td>
                      <td>
                        <span style={{ color: "var(--mn-ink-900)", fontWeight: 500 }}>
                          {f.details?.message ?? f.check_id}
                        </span>
                      </td>
                      <td>
                        <ModChip>{f.module}</ModChip>
                      </td>
                      <td
                        className="mn-tabular"
                        style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {ruleLabel(f)}
                      </td>
                      <td className="right mn-tabular">{f.affected_count.toLocaleString()}</td>
                      <td className="mn-tabular" style={{ color: "var(--mn-ink-500)" }}>
                        —
                      </td>
                      <td>
                        <StatusDot status={deriveStatus(f)} />
                      </td>
                    </tr>
                  ))}
                  {visibleFindings.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                        No findings match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="mn-detail">
            {selected ? (
              <>
                <div className="mn-detail-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <SevTag sev={mapSeverity(selected.severity)} />
                    <span
                      style={{
                        font: "600 11.5px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-ink-500)",
                      }}
                    >
                      {selected.id.slice(0, 8)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="mn-icon-btn"
                    style={{ width: 28, height: 28 }}
                    aria-label="Copy finding ID"
                    onClick={() => copyToClipboard(selected.id, "Finding ID copied")}
                  >
                    <MoreH size={14} />
                  </button>
                </div>
                <h3 className="mn-detail-title">{selected.details?.message ?? selected.check_id}</h3>
                <div className="mn-detail-meta">
                  <div><span className="k">Module</span><span className="v">{selected.module}</span></div>
                  <div><span className="k">Rule</span><span className="v mn-tabular">{selected.check_id}</span></div>
                  <div><span className="k">Dimension</span><span className="v">{selected.dimension}</span></div>
                  <div><span className="k">Records</span><span className="v mn-tabular">{selected.affected_count.toLocaleString()}</span></div>
                  <div><span className="k">Pass rate</span><span className="v mn-tabular">{selected.pass_rate === null ? "—" : `${Math.round(selected.pass_rate)}%`}</span></div>
                  <div><span className="k">Status</span><span className="v"><StatusDot status={deriveStatus(selected)} /></span></div>
                </div>
                {selected.remediation_text && (
                  <div className="mn-detail-section">
                    <div className="mn-eyebrow">Remediation</div>
                    <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--mn-ink-500)", lineHeight: 1.55 }}>
                      {selected.remediation_text}
                    </p>
                  </div>
                )}
                <div className="mn-detail-actions">
                  <button
                    type="button"
                    className="mn-btn mn-btn-ghost"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => copyToClipboard(selected.check_id, "Check ID copied")}
                  >
                    Copy check ID
                  </button>
                  <button
                    type="button"
                    className="mn-btn mn-btn-ghost"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={() => copyToClipboard(selected.id, "Finding ID copied")}
                  >
                    Copy finding ID
                  </button>
                </div>
              </>
            ) : (
              <p style={{ color: "var(--mn-ink-400)", fontSize: 13 }}>
                Select a finding to see details.
              </p>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}
