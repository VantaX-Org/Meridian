"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { Chip, Pager, Panel, Stack, Stat, Text } from "@/components/aurora";
import { getFindings } from "@/lib/api/findings";
import { getFindingRecords, getVersion } from "@/lib/api/versions";
import { copyToClipboard, saveView } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import { formatModuleName } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import type { Dimension, Finding, Severity } from "@/types/api";

type SevKey = "critical" | "high" | "medium" | "low";
type Status = "open" | "in-review" | "resolved";

const PAGE = 200;
const RECORDS_PAGE = 25;
/** Filters live in the URL so versions, trends and the command centre can link straight to a slice. */
const FILTER_KEYS = ["version_id", "module", "severity", "dimension", "check_id"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type FindingFilter = Partial<Record<FilterKey, string>>;
const FILTER_LABEL: Record<FilterKey, string> = {
  version_id: "version", module: "object", severity: "severity", dimension: "dimension", check_id: "check",
};
const DIMENSIONS: Dimension[] = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];

const cellText = (v: unknown): string =>
  v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

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
  return (
    <Suspense>
      <FindingsWorkspace />
    </Suspense>
  );
}

function FindingsWorkspace() {
  const { can } = useRole();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = useMemo(() => {
    const f: FindingFilter = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    return f;
  }, [params]);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const set = (patch: FindingFilter) => {
    const next = { ...filter, ...patch };
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    setOffset(0);
    setSelectedId(null);
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const clearAll = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) as FindingFilter);
  const active = FILTER_KEYS.filter((k) => filter[k]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["findings.list", filter, offset],
    queryFn: () => getFindings({ ...filter, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  const findings: Finding[] = useMemo(() => data?.findings ?? [], [data]);
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
        <PageHead title="Findings" route="Quality · /findings" sub="Loading findings…" />
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
        <PageHead title="Findings" route="Quality · /findings" sub="Failed to load findings." />
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
        route="Quality · /findings"
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
              onClick={() => saveView("findings", filter)}
            >
              <BookmarkIcon /> Save view
            </button>
            {can("manage_rules") && (
              <Link href="/settings/rules" className="mn-btn mn-btn-primary">New rule</Link>
            )}
          </>
        }
      />

      {filter.version_id && filter.module && (
        <ObjectScores versionId={filter.version_id} module={filter.module} dimension={filter.dimension}
          onDimension={(d) => set({ dimension: d })} />
      )}

      {/* Stat rail */}
      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))", marginBottom: 14 }}>
        <KPI label="Open" value={total} />
        <KPI label="Critical" value={counts.critical} tone="neg" />
        <KPI label="High" value={counts.high} tone="warn" />
        <KPI label="Medium" value={counts.medium} tone="warn" />
        <KPI label="Low" value={counts.low} />
        <KPI label="Objects affected" value={facets.module.length} />
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
            {active.map((k) => (
              <Chip key={k} onDismiss={() => set({ [k]: undefined })}>
                {FILTER_LABEL[k]} · {k === "version_id" ? filter[k]?.slice(0, 8) : k === "module" ? formatModuleName(filter[k] ?? "") : filter[k]}
              </Chip>
            ))}
            {active.length > 0 && (
              <button type="button" className="mn-link" onClick={clearAll}>
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
            <Facet title="Severity" items={facets.severity} activeKey={filter.severity ?? null}
              onClick={(k) => set({ severity: k ?? undefined })} />
            <Facet title="Object" items={facets.module} activeKey={filter.module ?? null}
              onClick={(k) => set({ module: k ?? undefined })} />
          </aside>

          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="mn-table-wrap">
              <table className="mn-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>Severity</th>
                    <th>ID</th>
                    <th>Finding</th>
                    <th>Object</th>
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
            <div style={{ padding: "10px 20px" }}>
              <Pager offset={offset} total={total} pageSize={PAGE} noun="findings"
                onChange={(o) => { setOffset(o); setSelectedId(null); }} />
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
                  <div><span className="k">Object</span><span className="v">{selected.module}</span></div>
                  <div><span className="k">Rule</span><span className="v mn-tabular">{selected.check_id}</span></div>
                  <div><span className="k">Dimension</span><span className="v">{selected.dimension}</span></div>
                  {selected.details?.field_checked && (
                    <div><span className="k">Field</span><span className="v mn-tabular">{selected.details.field_checked}</span></div>
                  )}
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
                <FindingEvidence finding={selected} />
                {selected.affected_count > 0 && (
                  <VersionRecords key={`${selected.version_id}:${selected.check_id}`}
                    versionId={selected.version_id} checkId={selected.check_id} />
                )}
                <div className="mn-detail-actions">
                  {selected.affected_count > 0 && (
                    <Link
                      className="mn-btn mn-btn-primary"
                      style={{ flex: 1, justifyContent: "center" }}
                      href={`/issues?${new URLSearchParams({
                        check_id: selected.check_id, status: "open",
                        version_id: selected.version_id, module: selected.module,
                      })}`}
                    >
                      Failing records
                    </Link>
                  )}
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

/* ── One object in one version: DQS + the six dimensions ─────────── */

function ObjectScores({
  versionId,
  module,
  dimension,
  onDimension,
}: {
  versionId: string;
  module: string;
  dimension?: string;
  onDimension: (d: string | undefined) => void;
}) {
  const { data: v, error } = useQuery({ queryKey: ["version", versionId], queryFn: () => getVersion(versionId) });
  const s = v?.dqs_summary?.[module];
  return (
    <div style={{ marginBottom: 14 }}>
      <Panel
        title={`${formatModuleName(module)} · ${v ? new Date(v.run_at).toLocaleString() : versionId.slice(0, 8)}`}
        action={v?.label ? <Text variant="text-small" tone="secondary">{v.label}</Text> : undefined}
      >
        {error ? (
          <Text tone="muted">This version could not be read.</Text>
        ) : !v ? (
          <Text tone="muted">Reading this version&rsquo;s scores…</Text>
        ) : !s ? (
          <Text tone="muted">This version has no score for {formatModuleName(module)}.</Text>
        ) : (
          <Stack gap={3}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
              <Stat label="DQS" value={s.composite_score.toFixed(1)} tone={s.capped ? "warning" : "neutral"} />
              {DIMENSIONS.map((d) => (
                <button key={d} type="button" className="text-left" aria-pressed={dimension === d}
                  title={`Show only ${d} findings`} onClick={() => onDimension(dimension === d ? undefined : d)}>
                  <Stat label={d} value={s.dimension_scores?.[d]?.toFixed(1) ?? "—"} tone={dimension === d ? "info" : "neutral"} />
                </button>
              ))}
            </div>
            {s.capped && s.cap_reason && <Text variant="text-small" tone="secondary">Capped: {s.cap_reason}</Text>}
          </Stack>
        )}
      </Panel>
    </div>
  );
}

/* ── What the check saw: sample records + invalid values ─────────── */

function FindingEvidence({ finding }: { finding: Finding }) {
  const samples = finding.details?.sample_failing_records ?? [];
  const invalid = Object.entries(finding.details?.distinct_invalid_values ?? {}).sort((a, b) => b[1] - a[1]);
  const cols = Array.from(new Set(samples.flatMap((r) => Object.keys(r))));
  return (
    <>
      {samples.length > 0 && (
        <div className="mn-detail-section">
          <div className="mn-eyebrow">Sample failing records</div>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="px-2 py-1 text-left font-mono font-medium text-[var(--mn-ink-500)]">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {samples.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c} className="border-t border-[var(--mn-line-2)] px-2 py-1 font-mono">{cellText(r[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {invalid.length > 0 && (
        <div className="mn-detail-section">
          <div className="mn-eyebrow">Invalid values</div>
          <Stack direction="row" gap={1} wrap className="mt-2">
            {invalid.slice(0, 20).map(([val, n]) => (
              <Chip key={val}><span className="font-mono">{val || "(blank)"}</span> × {n.toLocaleString()}</Chip>
            ))}
          </Stack>
          {invalid.length > 20 && <Text variant="text-small" tone="muted">{invalid.length - 20} more values</Text>}
        </div>
      )}
    </>
  );
}

/* ── Every record this check found failing in the finding's version ── */

function VersionRecords({ versionId, checkId }: { versionId: string; checkId: string }) {
  const [offset, setOffset] = useState(0);
  const { data } = useQuery({
    queryKey: ["finding.records", versionId, checkId, offset],
    queryFn: () => getFindingRecords(versionId, checkId, { limit: RECORDS_PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="mn-detail-section">
      <div className="mn-eyebrow">Records in this version</div>
      {!data ? (
        <Text variant="text-small" tone="muted">Reading record keys…</Text>
      ) : data.total === 0 ? (
        <Text variant="text-small" tone="muted">No record keys were stored for this check in this version.</Text>
      ) : (
        <Stack gap={2} className="mt-2">
          <Stack direction="row" gap={1} wrap>
            {data.records.map((r) => (
              <Chip key={r.record_key}><span className="font-mono">{r.record_key}</span></Chip>
            ))}
          </Stack>
          <Pager offset={offset} total={data.total} pageSize={RECORDS_PAGE} onChange={setOffset} noun="records" />
        </Stack>
      )}
    </div>
  );
}
