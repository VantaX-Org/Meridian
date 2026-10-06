"use client";

/**
 * Finding detail: one check on one object in one run.
 * Why it matters, what it breaks in SAP, the rule, the check across runs,
 * sample failing records with the fix Meridian proposes, and remediation.
 * The run is a hint in the URL (?v=); the API has no single-finding read.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Button, Sparkline } from "@/components/aurora";
import {
  Chip, DataTable, EmptyState, FieldChip, KeyValue, Mono, Pager, PageHeader, ReasonButton, SectionCard, StatusBadge,
  Tally, TableSkeleton, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { copyToClipboard } from "@/lib/actions";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getFinding, getFindings, type FindingDetailData } from "@/lib/api/findings";
import { getIssues, updateIssues } from "@/lib/api/issues";
import { getRules } from "@/lib/api/rules";
import { getFindingRecords } from "@/lib/api/versions";
import { checkClassLabel, formatModuleName, formatDate } from "@/lib/format";
import type { AnomalySample, Finding } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const PAGE = 25;
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const money = (n: number) => n.toLocaleString(undefined, { notation: n >= 100_000 ? "compact" : "standard", maximumFractionDigits: n >= 100_000 ? 1 : 0 });
const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "(blank)" : typeof v === "object" ? JSON.stringify(v) : String(v));
/** "LFA1.STCD1" or "STCD1": the part after the last dot. */
const fieldOf = (s: string) => s.slice(s.lastIndexOf(".") + 1);
const splitField = (s: string) => (s.includes(".") ? { table: s.slice(0, s.indexOf(".")), field: fieldOf(s) } : { table: null, field: s });

export function FindingDetailPage({ id }: { id: string }) {
  const hint = useSearchParams().get("v");
  const q = useQuery({ queryKey: ["finding", id, hint], queryFn: () => getFinding(id, hint), retry: false });
  const f = q.data;
  const crumb = (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "object", label: `Object: ${f ? formatModuleName(f.module) : "…"}`, href: f ? `/analyse/object/${encodeURIComponent(f.module)}` : undefined },
      { level: "check", label: `Check: ${f?.check_id ?? "…"}` },
    ]} />
  );
  if (q.error) {
    return (
      <div className="ui-page">
        {crumb}
        <Banner tone="danger" title="This finding could not be read"
          action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>Retry</Button>}>
          {(q.error as Error).message}
        </Banner>
      </div>
    );
  }
  if (!f) return <div className="ui-page">{crumb}<TableSkeleton rows={8} label="Loading finding" /></div>;
  return <div className="ui-page">{crumb}<Body f={f} /></div>;
}

function Body({ f }: { f: FindingDetailData }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const { user } = useAuth();
  const search = useSearchParams();
  const tab = search.get("tab");
  const rep = f.context;
  const anomaly = f.finding_type === "anomaly";
  const title = f.business_name ?? f.details?.message ?? f.check_id;
  const fieldChecked = f.details?.field_checked ?? (f.details?.table && f.details?.field ? `${f.details.table}.${f.details.field}` : null);
  const issuesHref = `/issues?${new URLSearchParams({ check_id: f.check_id, module: f.module, version_id: f.version_id })}`;
  const moduleHref = `/analyse?${new URLSearchParams({ tab: "findings", module: f.module })}`;

  const runs = useQuery({ queryKey: ["finding.runs", f.module, f.check_id], queryFn: () => getFindings({ check_id: f.check_id, module: f.module, limit: 60 }) });
  const history = useMemo(() => [...(runs.data?.findings ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [runs.data]);
  const prev = history[history.findIndex((r) => r.id === f.id) + 1];

  const pct = f.pass_rate === null ? null : Math.round(f.pass_rate);
  const costDelta = f.cost_at_risk != null && prev?.cost_at_risk != null ? { value: Math.round(f.cost_at_risk - prev.cost_at_risk), good: "down" as const } : undefined;

  // ?tab=records lands on the record table
  useEffect(() => {
    if (tab === "records") document.getElementById("sample")?.scrollIntoView({ block: "start" });
  }, [tab]);

  const assignAll = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in to take records");
      const open = await getIssues({ check_id: f.check_id, module: f.module, status: "open", version_id: f.version_id, limit: 200 });
      if (!open.items.length) throw new Error("No open records to assign");
      return updateIssues({ ids: open.items.map((i) => i.id), assigned_to: user.id });
    },
    onSuccess: (r) => { toast.success(`${r.updated.toLocaleString()} records assigned to you`); void qc.invalidateQueries({ queryKey: ["issues"] }); },
    onError: (e: Error) => toast.error("Could not assign records", { description: e.message }),
  });

  const falsePositive = useMutation({
    mutationFn: async (note: string) => {
      const open = await getIssues({ check_id: f.check_id, module: f.module, status: "open", version_id: f.version_id, limit: 200 });
      if (!open.items.length) throw new Error("No open records to mark");
      return updateIssues({ ids: open.items.map((i) => i.id), status: "accepted", resolution: "false_positive", note });
    },
    onSuccess: (r) => { toast.success(`${r.updated.toLocaleString()} records marked as false positive`); void qc.invalidateQueries({ queryKey: ["issues"] }); },
    onError: (e: Error) => toast.error("Could not mark as false positive", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title={title}
        summary={
          <span className="ui-o360__sticky">
            <StatusBadge status={(SEVERITIES.has(f.severity) ? f.severity : "low") as Status}>{cap(f.severity)}</StatusBadge>
            <span>{cap(f.dimension)}</span>
            {fieldChecked ? <FieldChip {...splitField(fieldChecked)} /> : null}
            <Mono>{f.check_id}</Mono>
          </span>
        }
        actions={
          <>
            {f.affected_count > 0 ? <Button onClick={() => router.push(issuesHref)}>Work failing records</Button> : null}
            {f.affected_count > 0 && can("assign") ? <Button variant="secondary" disabled={assignAll.isPending} onClick={() => assignAll.mutate()}>Assign all</Button> : null}
            {f.affected_count > 0 ? <Button variant="secondary" onClick={() => router.push("/workbench?view=mine")}>Open in inbox</Button> : null}
            <Button variant="ghost" onClick={() => copyToClipboard(f.check_id, "Check id copied")}>Copy check id</Button>
            {can("approve") && f.affected_count > 0 ? (
              <ReasonButton label="False positive" prompt="Why are these records not an issue?" disabled={falsePositive.isPending}
                onConfirm={(note) => falsePositive.mutate(note)} />
            ) : null}
          </>
        }
      />

      <Tally level={3} label="This check in this run" figures={[
        { label: "Records affected", value: f.affected_count, href: issuesHref, tone: f.severity === "critical" ? "danger" : f.severity === "high" ? "high" : undefined,
          verdict: f.affected_count === 0 ? "No record fails this check." : `${f.affected_count.toLocaleString()} of ${f.total_count.toLocaleString()} records fail.` },
        { label: "Of total", value: f.total_count, href: "#sample", verdict: "Records this check examined." },
        { label: "Pass rate", value: pct, unit: "%", href: "#runs",
          verdict: pct === null ? "No pass rate for this check." : `${(f.total_count - f.affected_count).toLocaleString()} of ${f.total_count.toLocaleString()} records pass.` },
        { label: "Cost at risk", value: null, text: f.cost_at_risk == null ? undefined : money(f.cost_at_risk), href: "#remediation", delta: costDelta,
          verdict: f.cost_at_risk == null ? "No cost model for this check." : `${f.cost_formula ?? "Worked out from the records that fail."}${f.cost_formula?.endsWith(".") ? "" : "."}`.replace("..", ".") },
      ]} />

      <Why f={f} />
      <RuleSection f={f} anomaly={anomaly} fieldChecked={fieldChecked} />
      <section id="runs"><Runs f={f} history={history} loading={runs.isLoading} /></section>
      <section id="sample"><Sample f={f} fieldChecked={fieldChecked} /></section>
      <section id="remediation">
        <SectionCard title="Remediation">
          {f.remediation_text || rep?.effort_estimate || rep?.fix_sequence ? (
            <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
              {f.remediation_text ? <p className="ui-note">{f.remediation_text}</p> : null}
              <KeyValue rows={[
                ...(rep?.effort_estimate ? [
                  { k: "Effort", v: `${rep.effort_estimate.estimated_person_hours} person hours, ${rep.effort_estimate.fix_complexity} fix` },
                  { k: "Basis", v: rep.effort_estimate.estimation_basis }] : []),
                ...(rep?.fix_sequence ? [{ k: "Fix order", v: `Step ${rep.fix_sequence.sequence}. ${rep.fix_sequence.reason}` }] : []),
              ]} />
              <p className="ui-note"><Link className="ui-link" href={moduleHref}>All findings for {formatModuleName(f.module)}</Link></p>
            </div>
          ) : <EmptyState action={<Link className="ui-link" href={issuesHref}>Work failing records</Link>}>No remediation text is recorded for this check.</EmptyState>}
        </SectionCard>
      </section>
    </>
  );
}

function Why({ f }: { f: FindingDetailData }) {
  const ctx = f.rule_context;
  const impact = useQuery({ queryKey: ["config-impact", f.version_id], queryFn: () => getConfigImpact(f.version_id), retry: false, meta: { ignoreError: true } });
  const blocked = (impact.data?.results ?? []).filter((r) => r.status !== "ok" && r.blocking_findings.some((b) => b.check_id === f.check_id && b.module === f.module));
  return (
    <div className="ui-o360__charts">
      <SectionCard title="Why it matters">
        {ctx?.why_it_matters ? <p className="ui-note">{ctx.why_it_matters}</p>
          : <EmptyState>No business reason is recorded for this check.</EmptyState>}
        {f.business_definition ? <p className="ui-note" style={{ marginTop: "var(--aurora-space-3)" }}><strong>{f.business_name ?? "Glossary"}.</strong> {f.business_definition}</p> : null}
      </SectionCard>
      <SectionCard title="What breaks in SAP">
        {ctx?.sap_impact ? <p className="ui-note">{ctx.sap_impact}</p> : null}
        {blocked.length ? (
          <ul className="ui-o360__features" style={{ marginTop: "var(--aurora-space-3)" }}>
            {blocked.map((r) => (
              <li key={r.feature} data-status={r.status}>
                <div className="ui-o360__feature-head">
                  <StatusBadge status={r.status === "blocked" ? "critical" : "medium"}>{cap(r.status)}</StatusBadge>
                  <strong>{r.feature}</strong>
                </div>
                {r.blocked_transactions.length ? <p className="ui-o360__tcodes">{r.blocked_transactions.map((t) => <Mono key={t}>{t}</Mono>)}</p> : null}
              </li>
            ))}
          </ul>
        ) : !ctx?.sap_impact ? <EmptyState>No assessed SAP feature depends on this check.</EmptyState> : null}
      </SectionCard>
    </div>
  );
}

const METRIC: Record<string, string> = { volume: "Row count", null_rate: "Blank rate", new_values: "New values", vanished_values: "Values gone" };

function RuleSection({ f, anomaly, fieldChecked }: { f: Finding; anomaly: boolean; fieldChecked: string | null }) {
  const d = f.details ?? {};
  const rule = useQuery({
    queryKey: ["rules.for-check", f.module, f.check_id], enabled: !anomaly, retry: false, meta: { ignoreError: true },
    queryFn: () => getRules({ module: f.module, search: f.check_id, limit: 10 }),
  });
  const r = rule.data?.rules.find((x) => x.name.split(":")[0] === f.check_id);
  const invalid = Object.entries(d.distinct_invalid_values ?? {}).sort((a, b) => b[1] - a[1]);
  const labels = Object.entries(f.rule_context?.valid_values_with_labels ?? {});
  const conditions = r?.conditions == null ? [] : Array.isArray(r.conditions) ? r.conditions : [r.conditions];
  const checkClass = f.check_class ?? (conditions as { check_class?: unknown }[]).map((c) => c?.check_class).find((v): v is string => typeof v === "string" && !!v) ?? null;
  const expectedText = labels.length ? `One of ${labels.length.toLocaleString()} valid values`
    : r?.description && r.description !== f.details?.message ? r.description : (f.details?.message ?? "As the rule defines");
  const rows: { k: string; v: ReactNode; mono?: boolean }[] = anomaly
    ? [{ k: "Measure", v: METRIC[d.metric ?? ""] ?? d.metric ?? "—" },
       { k: "Expected", v: d.expected && d.expected.low != null ? `${d.expected.low.toLocaleString()} to ${d.expected.high?.toLocaleString() ?? "—"}` : "Seen in earlier downloads" },
       { k: "Observed", v: typeof d.observed === "number" ? d.observed.toLocaleString() : Array.isArray(d.observed) ? `${d.observed.length.toLocaleString()} values` : "—" }]
    : [{ k: "Check type", v: checkClass ? <span title={checkClass}>{checkClassLabel(checkClass)}</span> : "—" },
       { k: "Field", v: fieldChecked ? <FieldChip {...splitField(fieldChecked)} /> : "—" },
       { k: "Expected", v: expectedText },
       { k: "Observed", v: `${f.affected_count.toLocaleString()} of ${f.total_count.toLocaleString()} records fail` },
       ...(r ? [{ k: "Source", v: r.source === "yaml" ? (r.source_yaml ? `checks/rules/${r.source_yaml}` : "Shipped rule") : "Defined in HQ", mono: r.source === "yaml" }] : [])];
  return (
    <SectionCard title="The rule">
      <div className="ui-stack" style={{ gap: "var(--aurora-space-4)" }}>
        <KeyValue rows={rows} />
        {labels.length ? (
          <div className="ui-filterbar__chips">
            {labels.slice(0, 30).map(([k, v]) => <Chip key={k}><Mono>{k}</Mono> {v}</Chip>)}
          </div>
        ) : null}
        {invalid.length ? (
          <div>
            <p className="ui-micro">Values found that the rule rejects</p>
            <div className="ui-filterbar__chips">
              {invalid.slice(0, 20).map(([v, n]) => <Chip key={v}><Mono>{v || "(blank)"}</Mono><span className="aurora-number ui-chip-count">{n.toLocaleString()}</span></Chip>)}
            </div>
          </div>
        ) : null}
        {conditions.length ? (
          <pre className="ui-code" aria-label="Rule conditions">{conditions.map((c) => Object.entries(c as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n")).join("\n---\n")}</pre>
        ) : null}
        {anomaly ? <AnomalySamples f={f} /> : null}
      </div>
    </SectionCard>
  );
}

function AnomalySamples({ f }: { f: Finding }) {
  const bad = f.details?.samples?.bad ?? [];
  const good = f.details?.samples?.good ?? [];
  if (!bad.length && !good.length) return null;
  return (
    <div className="ui-matrix-scroll">
      <table className="ui-mini-table">
        <thead><tr><th scope="col">Sample</th><th scope="col">Record key</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {([["Deviating", bad], ["As usual", good]] as const).flatMap(([label, list]) => (list as AnomalySample[]).map((r, i) => (
            <tr key={`${label}${i}`}><td>{label}</td><td><Mono>{r.record_key}</Mono></td><td><Mono>{"value" in r ? cell(r.value) : "not stored"}</Mono></td></tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function Runs({ f, history, loading }: { f: Finding; history: Finding[]; loading: boolean }) {
  const router = useRouter();
  const points = [...history].reverse().filter((r) => r.pass_rate !== null).map((r) => ({ at: r.created_at.slice(0, 10), rate: Math.round((r.pass_rate ?? 0) * 10) / 10 }));
  const columns = useMemo<ColumnDef<Finding, unknown>[]>(() => [
    { id: "at", header: "Run", meta: meta({ width: 180 }), cell: ({ row }) => (
      <span>{formatDate(row.original.created_at, "datetime")}{row.original.id === f.id ? <span className="ui-micro"> this run</span> : null}</span>) },
    { id: "affected", header: "Records affected", meta: meta({ align: "end", numeric: true }), cell: ({ row }) => `${row.original.affected_count.toLocaleString()} of ${row.original.total_count.toLocaleString()}` },
    { id: "pass", header: "Pass rate", meta: meta({ width: 110, align: "end", numeric: true }), cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${row.original.pass_rate.toFixed(1)}%`) },
  ], [f.id]);
  return (
    <SectionCard title="This check across runs" meta={history.length > 1 ? "Select a run to open it" : undefined} flush>
      {loading ? <TableSkeleton rows={3} label="Loading runs" /> : history.length < 2 ? (
        <EmptyState>This is the only run that has evaluated this check.</EmptyState>
      ) : (
        <>
          {points.length > 1 ? <div style={{ padding: "var(--aurora-space-4)" }}><Sparkline data={points} xKey="at" yKey="rate" height={48} ariaLabel="Pass rate per run" /></div> : null}
          <DataTable columns={columns} data={history} getRowId={(r) => r.id} ariaLabel="This check across runs" maxHeight="280px"
            onRowActivate={(r) => router.push(`/analyse/finding/${r.id}?v=${r.version_id}`)} />
        </>
      )}
    </SectionCard>
  );
}

type SampleRow = { key: string; values: Record<string, string>; issueId?: string; fix?: string };

function Sample({ f, fieldChecked }: { f: Finding; fieldChecked: string | null }) {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const recs = useQuery({
    queryKey: ["finding.records", f.version_id, f.check_id, offset], enabled: f.affected_count > 0,
    queryFn: () => getFindingRecords(f.version_id, f.check_id, { limit: PAGE, offset }), placeholderData: keepPreviousData,
  });
  const issues = useQuery({
    queryKey: ["issues", "check", f.version_id, f.check_id, f.module], enabled: f.affected_count > 0, retry: false, meta: { ignoreError: true },
    queryFn: () => getIssues({ check_id: f.check_id, module: f.module, version_id: f.version_id, limit: 200 }),
  });
  const byKey = useMemo(() => new Map((issues.data?.items ?? []).map((i) => [i.record_key, i.id])), [issues.data]);

  const stored = useMemo(() => recs.data?.records ?? [], [recs.data]);
  const sampleFailing = f.details?.sample_failing_records;
  const fallback = useMemo(() => sampleFailing ?? [], [sampleFailing]);
  const rows = useMemo<SampleRow[]>(() => {
    const fixFor = (key: string, value?: string) => {
      const rf = f.record_fixes?.find((x) => x.record_id === key);
      if (rf) return rf.fix_instruction;
      const vf = value !== undefined ? f.value_fix_map?.[value] : undefined;
      return vf ? (vf.suggested_value ? `Use ${vf.suggested_value}` : vf.fix_instruction) : undefined;
    };
    const failing = (vals: Record<string, string>) => {
      const k = Object.keys(vals).find((c) => fieldChecked && fieldOf(c) === fieldOf(fieldChecked));
      return k ? vals[k] : undefined;
    };
    if (stored.length) return stored.map((r) => ({ key: r.record_key, values: r.field_values ?? {}, issueId: byKey.get(r.record_key), fix: fixFor(r.record_key, failing(r.field_values ?? {})) }));
    const idField = f.details?.id_field_used;
    return fallback.map((r, i) => {
      const vals = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]));
      const key = idField && r[idField] != null ? String(r[idField]) : `Sample ${i + 1}`;
      return { key, values: vals, issueId: byKey.get(key), fix: fixFor(key, failing(vals)) };
    });
  }, [stored, fallback, byKey, f.record_fixes, f.value_fix_map, f.details?.id_field_used, fieldChecked]);

  const cols = useMemo(() => Array.from(new Set(rows.flatMap((r) => Object.keys(r.values)))).slice(0, 8), [rows]);
  const hasFix = rows.some((r) => r.fix);
  const isFailing = (c: string) => !!fieldChecked && fieldOf(c) === fieldOf(fieldChecked);
  const columns = useMemo<ColumnDef<SampleRow, unknown>[]>(() => [
    { id: "key", header: "Record", meta: meta({ sticky: "start", minWidth: 200, mono: true }), cell: ({ row }) => (
      row.original.issueId
        ? <Link className="ui-link" href={`/workbench/record/${row.original.issueId}`} onClick={(e) => e.stopPropagation()}><Mono>{row.original.key}</Mono></Link>
        : <Mono>{row.original.key}</Mono>) },
    ...cols.map((c): ColumnDef<SampleRow, unknown> => ({
      id: `f:${c}`, meta: meta({ minWidth: 120, mono: true }),
      header: () => <span title={isFailing(c) ? "The field this check judges" : undefined}><FieldChip {...splitField(c)} />{isFailing(c) ? <span className="ui-micro"> fails</span> : null}</span>,
      cell: ({ row }) => <span data-failing={isFailing(c) || undefined} style={isFailing(c) ? { color: "var(--aurora-status-danger-500)" } : undefined}>{cell(row.original.values[c])}</span>,
    })),
    ...(hasFix ? [{ id: "fix", header: "Proposed value", meta: meta({ minWidth: 200 }), cell: ({ row }: { row: { original: SampleRow } }) => row.original.fix ?? <span className="ui-micro">—</span> } as ColumnDef<SampleRow, unknown>] : []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [cols, hasFix, fieldChecked]);

  const total = recs.data?.total ?? rows.length;
  return (
    <SectionCard title="Sample failing records" meta={rows.length ? `${total.toLocaleString()} fail in this run` : undefined} flush>
      {recs.isLoading ? <TableSkeleton rows={5} label="Loading records" /> : rows.length === 0 ? (
        <EmptyState>No sample records were kept for this check.</EmptyState>
      ) : (
        <>
          <DataTable columns={columns} data={rows} getRowId={(r, i) => `${r.key}:${i}`} ariaLabel="Sample failing records" maxHeight="420px"
            onRowActivate={(r) => { if (r.issueId) router.push(`/workbench/record/${r.issueId}`); }} />
          {stored.length ? <div style={{ padding: "var(--aurora-space-3) var(--aurora-space-4)" }}><Pager offset={offset} total={total} pageSize={PAGE} onChange={setOffset} noun="records" /></div> : null}
        </>
      )}
    </SectionCard>
  );
}
