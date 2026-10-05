"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Tally } from "@/components/ui-core";
import { Skeleton } from "@/components/ui/skeleton";
import { LineageGraphView } from "@/components/lineage/lineage-graph";
import {
  getBlastRadius,
  getLineage,
  getLineageGuards,
  getLineageImpact,
  getLineageModel,
  type ImpactRow,
  type LineageDirection,
  type Severity,
} from "@/lib/api/lineage";
import { getVersions } from "@/lib/api/versions";
import type { Version } from "@/types/api";

const SEV_TONE: Record<Severity, string> = {
  critical: "var(--mn-neg)",
  high: "var(--mn-neg)",
  medium: "var(--mn-warn)",
  low: "var(--mn-ink-500)",
};

const MONO = "500 12px/1.3 'JetBrains Mono', monospace";

function isCompleteVersion(v: Version): boolean {
  return (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;
}

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function SevLabel({ sev }: { sev: Severity | null }) {
  if (!sev) return <span style={{ color: "var(--mn-ink-300)" }}>—</span>;
  return <span style={{ color: SEV_TONE[sev], font: "700 10px/1 'JetBrains Mono', monospace", letterSpacing: "0.08em" }}>{sev.toUpperCase()}</span>;
}

function ImpactTable({ title, rows, onPick }: { title: string; rows: ImpactRow[]; onPick: (id: string) => void }) {
  const withCost = rows.some((r) => r.cost_at_risk != null);
  return (
    <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="mn-card-pad" style={{ paddingBottom: 8, fontWeight: 600, color: "var(--mn-ink-900)" }}>{title}</div>
      <div className="mn-table-wrap">
        <table className="mn-table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 20 }}>Name</th>
              <th className="right">Findings</th>
              <th className="right" title="Sum over findings: upper bound, a record can fail several rules">Records (max)</th>
              {withCost && <th className="right">Cost at risk</th>}
              <th>Worst</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ paddingLeft: 20 }}>
                  <button type="button" className="mn-link" onClick={() => onPick(r.id)} style={{ background: "none", border: 0, padding: 0, color: "var(--mn-ink-900)", fontWeight: 500, cursor: "pointer" }}>
                    {r.label}
                  </button>
                  {r.worst_impact === "full_block" && (
                    <span style={{ marginLeft: 6, color: "var(--mn-neg)", font: "700 9.5px/1 'JetBrains Mono', monospace" }}>BLOCKS</span>
                  )}
                </td>
                <td className="right mn-tabular">{r.findings}</td>
                <td className="right mn-tabular">
                  {r.records_affected.toLocaleString()}{" "}
                  <span style={{ color: "var(--mn-ink-400)" }}>({r.max_records.toLocaleString()})</span>
                </td>
                {withCost && <td className="right mn-tabular">{(r.cost_at_risk ?? 0).toLocaleString()}</td>}
                <td><SevLabel sev={r.worst_severity} /></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={withCost ? 5 : 4} style={{ padding: 24, textAlign: "center", color: "var(--mn-ink-400)" }}>
                  No failing rules reach this level.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuardsPanel({ node, versionId }: { node: string; versionId?: string }) {
  const q = useQuery({
    queryKey: ["lineage.guards", node, versionId],
    queryFn: () => getLineageGuards({ node, version_id: versionId }),
  });
  if (q.isLoading) return <Skeleton className="h-[160px] rounded-[10px]" />;
  if (q.error || !q.data) return <div style={{ color: "var(--mn-neg)" }}>Could not load guards.</div>;
  const d = q.data;
  return (
    <div>
      <div style={{ marginBottom: 10, color: "var(--mn-ink-500)", fontSize: 13 }}>
        {d.steps.length} step(s) feed this node; <strong style={{ color: d.coverage_gaps.length ? "var(--mn-warn)" : "var(--mn-pos)" }}>{d.coverage_gaps.length}</strong> have no guarding rule.
      </div>
      <div className="mn-table-wrap">
        <table className="mn-table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 20 }}>Step</th>
              <th>T-code</th>
              <th className="right">Rules</th>
              <th className="right">Min pass rate</th>
              <th>Unguarded fields</th>
            </tr>
          </thead>
          <tbody>
            {d.steps.map((s) => (
              <tr key={s.id}>
                <td style={{ paddingLeft: 20 }}>
                  <div style={{ fontWeight: 500, color: "var(--mn-ink-900)" }}>{s.label}</div>
                  <div style={{ font: MONO, color: "var(--mn-ink-400)" }}>{s.id.replace("step:", "")}</div>
                </td>
                <td style={{ font: MONO }}>{s.tcode ?? "—"}</td>
                <td className="right mn-tabular" style={{ color: s.guard_count ? undefined : "var(--mn-warn)" }}>{s.guard_count}</td>
                <td className="right mn-tabular">{pct(s.min_pass_rate)}</td>
                <td style={{ font: MONO, color: "var(--mn-ink-500)" }}>{s.unguarded_fields.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BlastPanel({ checkId, versionId }: { checkId: string; versionId: string }) {
  const q = useQuery({
    queryKey: ["lineage.blast", versionId, checkId],
    queryFn: () => getBlastRadius(versionId, checkId),
  });
  if (q.isLoading) return <Skeleton className="h-[160px] rounded-[10px]" />;
  if (q.error || !q.data) return <div style={{ color: "var(--mn-neg)" }}>Could not load blast radius.</div>;
  const d = q.data;
  if (!d.failing_records) return <div style={{ color: "var(--mn-ink-400)" }}>No failing records stored for {checkId} in this version.</div>;
  return (
    <div>
      <div style={{ marginBottom: 10, color: "var(--mn-ink-500)", fontSize: 13 }}>
        {d.failing_records.toLocaleString()} failing {d.grain ?? ""} record(s){d.keys_truncated ? " (capped)" : ""} on object{" "}
        <strong>{d.object ?? "unmapped"}</strong> touch {d.processes_touched.length} process(es).
      </div>
      <div className="mn-table-wrap">
        <table className="mn-table">
          <thead>
            <tr>
              <th style={{ paddingLeft: 20 }}>Documents</th>
              <th className="right">Documents hit</th>
              <th className="right">Master records</th>
              <th>Joined on</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {d.targets.map((t) => (
              <tr key={t.table}>
                <td style={{ paddingLeft: 20 }}>
                  <div style={{ fontWeight: 500, color: "var(--mn-ink-900)" }}>{t.label}</div>
                  <div style={{ font: MONO, color: "var(--mn-ink-400)" }}>{t.table}</div>
                </td>
                <td className="right mn-tabular">{t.status === "ok" ? t.documents.toLocaleString() : "—"}</td>
                <td className="right mn-tabular">{t.status === "ok" ? t.objects_touched.toLocaleString() : "—"}</td>
                <td style={{ font: MONO, color: "var(--mn-ink-500)" }}>{t.joined_on.join(", ") || "—"}</td>
                <td style={{ color: "var(--mn-ink-500)", fontSize: 12.5 }}>
                  {t.status === "not_extracted" ? "Not extracted" : t.status === "not_joinable" ? "Record key lacks join field" : t.same_version ? "This version" : `Version ${t.source_version_id?.slice(0, 8)}`}
                </td>
              </tr>
            ))}
            {d.targets.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--mn-ink-400)" }}>
                  No transactional documents are modelled for this object.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LineagePage() {
  const [draft, setDraft] = useState("LFB1.ZTERM");
  const [focus, setFocus] = useState("LFB1.ZTERM");
  const [direction, setDirection] = useState<LineageDirection>("both");
  const [depth, setDepth] = useState(6);
  const [selected, setSelected] = useState<string | undefined>();

  const modelQ = useQuery({ queryKey: ["lineage.model"], queryFn: getLineageModel });
  const versionsQ = useQuery({ queryKey: ["versions.list", { limit: 10 }], queryFn: () => getVersions({ limit: 10 }) });
  const latest = useMemo(() => versionsQ.data?.versions.find(isCompleteVersion), [versionsQ.data]);
  const impactQ = useQuery({
    queryKey: ["lineage.impact", latest?.id],
    queryFn: () => getLineageImpact(latest!.id),
    enabled: !!latest,
  });
  const graphQ = useQuery({
    queryKey: ["lineage.graph", focus, direction, depth],
    queryFn: () => getLineage({ node: focus, direction, depth }),
    retry: false,
  });

  const pick = (id: string) => {
    setDraft(id);
    setFocus(id);
    setSelected(id);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) pick(draft.trim());
  };

  const sel = selected ?? graphQ.data?.start;
  const selType = sel?.split(":", 1)[0];
  const impact = impactQ.data;

  if (modelQ.isLoading) {
    return (
      <>
        <PageHeader title="Lineage and impact" summary="Building the lineage graph from the model." />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (modelQ.error || !modelQ.data) {
    return (
      <>
        <PageHeader title="Lineage and impact" summary="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/lineage/model</code>.
        </div>
      </>
    );
  }
  const model = modelQ.data;

  return (
    <>
      <PageHeader
        title="Lineage and impact"
        summary={`SAP field to config, process step, SAP feature and business KPI. Model v${model.model_version}, ${model.edge_count.toLocaleString()} edges${latest ? `, impact for version ${latest.id.slice(0, 8)}` : ""}.`}
      />

      <Tally level={2} label="Lineage impact" figures={[
        { label: "KPIs at risk", value: impact ? impact.kpis.length : null, loading: impactQ.isLoading, tone: impact?.kpis.length ? "danger" : undefined,
          verdict: impact ? `Of ${model.kpis.length} modelled.` : "Needs a completed version.", href: "/lineage" },
        { label: "Processes at risk", value: impact ? impact.processes.length : null, loading: impactQ.isLoading, tone: impact?.processes.length ? "warning" : undefined,
          verdict: impact?.processes.length ? "Reached by a failing rule." : "None.", href: "/lineage" },
        { label: "Features at risk", value: impact ? impact.features.length : null, loading: impactQ.isLoading, tone: impact?.features.length ? "warning" : undefined,
          verdict: impact?.features.length ? "SAP features a failing rule blocks." : "None.", href: "/lineage" },
        { label: "Rules off the map", value: impact ? impact.unmapped_checks.length : null, loading: impactQ.isLoading,
          verdict: "Failing rules with no modelled path to a KPI.", href: "/lineage" },
      ]} />

      {impact && (
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", marginBottom: 18 }}>
          <ImpactTable title="Business KPIs" rows={impact.kpis} onPick={pick} />
          <ImpactTable title="Processes" rows={impact.processes} onPick={pick} />
        </div>
      )}

      <div className="mn-card mn-card-pad" style={{ marginBottom: 18 }}>
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Trace
            <input
              className="mn-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="LFB1.ZTERM, AP017, kpi:dpo, finding:<id>"
              aria-label="Node to trace"
              style={{ minWidth: 280, font: MONO }}
            />
          </label>
          <select className="mn-input" value={direction} onChange={(e) => setDirection(e.target.value as LineageDirection)} aria-label="Direction">
            <option value="both">Up and downstream</option>
            <option value="down">Downstream</option>
            <option value="up">Upstream</option>
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            Depth
            <input className="mn-input" type="number" min={1} max={12} value={depth} onChange={(e) => setDepth(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} style={{ width: 64 }} />
          </label>
          <button type="submit" className="mn-btn mn-btn-primary">Trace</button>
        </form>
        {graphQ.isLoading && <Skeleton className="h-[320px] rounded-[10px]" />}
        {graphQ.error && <div style={{ color: "var(--mn-neg)" }}>Node <code>{focus}</code> is not in the lineage model.</div>}
        {graphQ.data && (
          <>
            <LineageGraphView data={graphQ.data} selected={sel} onSelect={setSelected} />
            {graphQ.data.paths_to_kpis.length > 0 && (
              <div style={{ marginTop: 12, font: MONO, color: "var(--mn-ink-500)" }}>
                {graphQ.data.paths_to_kpis.slice(0, 5).map((p) => (
                  <div key={p.join(">")}>{p.join(", then ")}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {sel && (
        <div className="mn-card mn-card-pad">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ font: MONO, color: "var(--mn-ink-900)" }}>{sel}</div>
            {sel !== focus && (
              <button type="button" className="mn-btn" onClick={() => pick(sel)}>Trace from here</button>
            )}
          </div>
          {(selType === "kpi" || selType === "feature" || selType === "process" || selType === "step") && (
            <GuardsPanel node={sel} versionId={latest?.id} />
          )}
          {selType === "check" && latest && <BlastPanel checkId={sel.slice("check:".length)} versionId={latest.id} />}
          {selType === "check" && !latest && <div style={{ color: "var(--mn-ink-400)" }}>Blast radius needs a completed version.</div>}
          {!["kpi", "feature", "process", "step", "check"].includes(selType ?? "") && (
            <div style={{ color: "var(--mn-ink-400)", fontSize: 13 }}>Select a rule for its blast radius, or a step, process, feature or KPI for its guarding rules.</div>
          )}
        </div>
      )}
    </>
  );
}
