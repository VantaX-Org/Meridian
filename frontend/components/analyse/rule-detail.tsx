"use client";

/**
 * Rule detail: one rule by its SAP-facing code, whether or not it has ever run.
 * Why it matters, what breaks in SAP, what the rule checks, where the field comes from,
 * how to fix a failing record, how the rule has done run by run, and who changed it.
 */

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Banner, Button } from "@/components/aurora";
import {
  Chip, DataTable, EmptyState, FieldChip, KeyValue, Mono, PageHeader, ScoreTrend, SectionCard, StatusBadge, TableSkeleton, Tally,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { copyToClipboard } from "@/lib/actions";
import { getFindings } from "@/lib/api/findings";
import { getIssues, type RecordIssue } from "@/lib/api/issues";
import { getDdicFields, getRuleByCode, getRuleVersions, type RuleDetail } from "@/lib/api/rules";
import { AUTHORITY_SENTENCE, checkClassLabel, failsWhen, formatDate, formatModuleName, labelOf } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
const splitField = (s: string) => (s.includes(".") ? { table: s.slice(0, s.indexOf(".")), field: s.slice(s.indexOf(".") + 1) } : { table: null, field: s });
const FIX_KEY: Record<string, string> = { __blank__: "Blank", __other__: "Any other value" };
const NAV = [["why", "Why"], ["sap", "SAP"], ["rule", "Rule"], ["lineage", "Lineage"], ["fix", "Fix"], ["history", "History"], ["records", "Records"], ["changes", "Changes"]] as const;

export function RuleDetailPage({ checkId }: { checkId: string }) {
  const mod = useSearchParams().get("module") ?? undefined;
  const q = useQuery({ queryKey: ["rule.by-code", checkId, mod], queryFn: () => getRuleByCode(checkId, mod), retry: false });
  const crumb = (r?: RuleDetail) => (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "object", label: `Object: ${r ? formatModuleName(r.module) : mod ? formatModuleName(mod) : "…"}`, href: r || mod ? `/analyse/object/${encodeURIComponent(r?.module ?? mod!)}` : undefined },
      { level: "check", label: `Rule: ${checkId}` },
    ]} />
  );
  if (q.error) {
    return (
      <div className="ui-page">
        {crumb()}
        <Banner tone="danger" title="This rule could not be read" action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>Retry</Button>}>
          {(q.error as Error).message}
        </Banner>
      </div>
    );
  }
  if (!q.data) return <div className="ui-page">{crumb()}<TableSkeleton rows={8} label="Loading rule" /></div>;
  return <div className="ui-page">{crumb(q.data)}<Body r={q.data} /></div>;
}

function Body({ r }: { r: RuleDetail }) {
  const router = useRouter();
  const runs = useQuery({ queryKey: ["rule.runs", r.module, r.id], queryFn: () => getFindings({ check_id: r.id, module: r.module, limit: 60 }) });
  const history = useMemo(() => [...(runs.data?.findings ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [runs.data]);
  const issues = useQuery({
    queryKey: ["rule.issues", r.module, r.id], retry: false, meta: { ignoreError: true },
    queryFn: () => getIssues({ check_id: r.id, module: r.module, limit: 25 }),
  });
  const open = useQuery({
    queryKey: ["rule.issues.open", r.module, r.id], retry: false, meta: { ignoreError: true },
    queryFn: () => getIssues({ check_id: r.id, module: r.module, status: "open", limit: 1 }),
  });
  const versions = useQuery({
    queryKey: ["rule.versions", r.rule_uuid], enabled: !!r.rule_uuid, retry: false, meta: { ignoreError: true },
    queryFn: () => getRuleVersions(r.rule_uuid!),
  });
  const latest = history[0];
  const neverRun = !runs.isLoading && history.length === 0;
  const failedRuns = history.filter((h) => h.affected_count > 0).length;
  const pct = latest?.pass_rate == null ? null : Math.round(latest.pass_rate);
  const failing = latest?.affected_count ?? 0;
  const issuesHref = `/issues?${new URLSearchParams({ check_id: r.id, module: r.module })}`;
  const adminHref = `/settings/rules?${new URLSearchParams({ module: r.module, check: r.check_class ?? "" })}`.replace(/&check=$/, "");
  const sev = r.severity && SEVERITIES.has(r.severity) ? r.severity : "low";
  const runHref = latest ? `/analyse/finding/${latest.id}?v=${latest.version_id}` : "/sync";

  const verdict = neverRun ? "This rule has not run in any version."
    : failing === 0 ? `Passing in the latest run. It failed in ${failedRuns.toLocaleString()} of ${plural(history.length, "run")}.`
    : `${plural(failing, "record")} fail in the latest run. The rule failed in ${failedRuns.toLocaleString()} of ${plural(history.length, "run")}.`;

  return (
    <>
      <PageHeader
        title={r.message ?? r.id}
        summary={
          <span className="ui-o360__sticky">
            <StatusBadge status={sev as Status}>{cap(sev)}</StatusBadge>
            {r.dimension ? <span>{labelOf(r.dimension)}</span> : null}
            {r.field ? <FieldChip {...splitField(r.field)} /> : null}
            <Mono>{r.id}</Mono>
            {r.check_class ? <span title={r.check_class}>{checkClassLabel(r.check_class)}</span> : null}
            {r.rule_authority ? <span>{AUTHORITY_SENTENCE[r.rule_authority]?.split(":")[0] ?? labelOf(r.rule_authority)}</span> : null}
          </span>
        }
        actions={
          <>
            {failing > 0 ? <Button onClick={() => router.push(issuesHref)}>Work failing records</Button> : null}
            <Button variant="secondary" onClick={() => router.push(adminHref)}>Open in rules admin</Button>
            <Button variant="ghost" onClick={() => copyToClipboard(r.id, "Rule code copied")}>Copy rule code</Button>
          </>
        }
      />
      <p className="ui-note" role="status">{runs.isLoading ? "Reading run history." : verdict}</p>

      <Tally level={3} label="This rule" figures={[
        { label: "Records failing now", loading: runs.isLoading, value: neverRun ? null : failing, text: neverRun ? "Not run" : undefined, href: neverRun ? "/sync" : issuesHref,
          tone: failing > 0 && (r.severity === "critical" || r.severity === "high") ? "danger" : undefined,
          verdict: neverRun ? "This rule has not run in any version." : failing === 0 ? "No record fails this rule." : `${failing.toLocaleString()} of ${(latest?.total_count ?? 0).toLocaleString()} records fail.` },
        { label: "Pass rate now", loading: runs.isLoading, value: neverRun ? null : pct, unit: pct === null ? undefined : "%", text: neverRun ? "Not run" : undefined, href: "#history",
          verdict: neverRun ? "This rule has not run in any version." : latest ? `${(latest.total_count - latest.affected_count).toLocaleString()} of ${latest.total_count.toLocaleString()} records pass.` : "" },
        { label: "Runs failed in", loading: runs.isLoading, value: neverRun ? null : failedRuns, text: neverRun ? "Not run" : undefined, href: "#history",
          verdict: neverRun ? "This rule has not run in any version." : `Failed in ${failedRuns.toLocaleString()} of ${plural(history.length, "run")}.` },
        { label: "Open issues", loading: open.isLoading, value: open.data?.total ?? null, href: issuesHref,
          verdict: open.data ? (open.data.total === 0 ? "No open record issue for this rule." : `${plural(open.data.total, "record")} still to fix.`) : "Open issues could not be read." },
      ]} />

      <div className="aurora-report__grid">
        <div className="aurora-report__body">
          <section id="why"><div className="ui-o360__charts">
            <SectionCard title="Why it matters">
              {r.why_it_matters ? <p className="ui-note">{r.why_it_matters}</p> : <EmptyState>No business reason is recorded for this rule.</EmptyState>}
            </SectionCard>
            <section id="sap">
              <SectionCard title="What breaks in SAP">
                <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
                  {r.sap_impact ? <p className="ui-note">{r.sap_impact}</p> : <EmptyState>No SAP impact is recorded for this rule.</EmptyState>}
                  {r.rule_authority ? <p className="ui-note">{AUTHORITY_SENTENCE[r.rule_authority] ?? labelOf(r.rule_authority)}</p> : null}
                </div>
              </SectionCard>
            </section>
          </div></section>

          <section id="rule"><TheRule r={r} /></section>
          <section id="lineage"><Lineage r={r} /></section>
          <section id="fix"><HowToFix r={r} /></section>
          <section id="history"><History points={history} loading={runs.isLoading} neverRun={neverRun} /></section>
          <section id="records"><Records items={issues.data?.items ?? []} loading={issues.isLoading} /></section>
          <section id="changes"><Changes r={r} data={versions.data?.versions} loading={versions.isLoading} /></section>
          {latest ? <p className="ui-note"><Link className="ui-link" href={runHref}>Open the latest finding for this rule</Link></p> : null}
        </div>
        <nav className="aurora-report__nav" aria-label="Rule sections">
          <ol className="aurora-report__nav-list">
            {NAV.map(([id, label]) => <li key={id}><a className="aurora-report__nav-link aurora-focus-ring" href={`#${id}`}><span>{label}</span></a></li>)}
          </ol>
        </nav>
      </div>
    </>
  );
}

function TheRule({ r }: { r: RuleDetail }) {
  const labels = Object.entries(r.valid_values_with_labels ?? {});
  return (
    <SectionCard title="The rule">
      <div className="ui-stack" style={{ gap: "var(--aurora-space-4)" }}>
        <KeyValue rows={[
          { k: "Fails when", v: failsWhen(r) },
          { k: "Check type", v: r.check_class ? <span title={r.check_class}>{checkClassLabel(r.check_class)}</span> : "As the rule defines" },
          { k: "Field", v: r.field ? <FieldChip {...splitField(r.field)} /> : "Not tied to one field" },
          { k: "Dimension", v: r.dimension ? labelOf(r.dimension) : "Not set" },
          { k: "State", v: r.enabled ? "Enabled" : "Disabled" },
          { k: "Source", v: r.source === "yaml" ? "Shipped rule" : r.source ? labelOf(r.source) : "Shipped rule" },
        ]} />
        {labels.length ? (
          <div className="ui-filterbar__chips">
            {labels.slice(0, 30).map(([k, v]) => <Chip key={k}><Mono>{k}</Mono> {v}</Chip>)}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function Lineage({ r }: { r: RuleDetail }) {
  const key = r.field && r.field.includes(".") ? r.field.toUpperCase() : null;
  const q = useQuery({ queryKey: ["ddic", key], enabled: !!key, retry: false, meta: { ignoreError: true }, queryFn: () => getDdicFields([key!]) });
  const f = q.data?.[0];
  return (
    <SectionCard title="Where the field comes from">
      {!key ? <EmptyState>This rule is not tied to one table field.</EmptyState> : q.isLoading ? <TableSkeleton rows={2} label="Reading dictionary" />
        : !f || f.missing ? <EmptyState>{`Dictionary has no entry for ${key.split(".")[0]}.`}</EmptyState> : (
          <KeyValue rows={[
            { k: "Field", v: <FieldChip table={f.table} field={f.field} /> },
            { k: "Description", v: f.description ?? "No description" },
            { k: "Data element", v: f.data_element ? <Mono>{f.data_element}</Mono> : "None" },
            { k: "Domain", v: f.domain ? <Mono>{f.domain}</Mono> : "None" },
            { k: "Type", v: f.type ? `${f.type}${f.length ? `, length ${f.length}` : ""}` : "Not set" },
            { k: "Check table", v: f.check_table ? <span><Mono>{f.check_table}</Mono>{f.check_table_description ? ` ${f.check_table_description}` : ""}</span> : "No check table" },
          ]} />
        )}
    </SectionCard>
  );
}

function HowToFix({ r }: { r: RuleDetail }) {
  const fixes = Object.entries(r.fix_map ?? {});
  const tpl = r.record_fix_template;
  if (!r.transaction && !fixes.length && !tpl) {
    return <SectionCard title="How to fix"><EmptyState>No fix guidance is recorded for this rule.</EmptyState></SectionCard>;
  }
  return (
    <SectionCard title="How to fix">
      <div className="ui-stack" style={{ gap: "var(--aurora-space-4)" }}>
        {r.transaction ? <KeyValue rows={[{ k: "Transaction", v: <Mono>{r.transaction}</Mono> }]} /> : null}
        {fixes.length ? (
          <div className="ui-matrix-scroll">
            <table className="ui-mini-table">
              <thead><tr><th scope="col">When the value is</th><th scope="col">Do this</th></tr></thead>
              <tbody>{fixes.map(([k, v]) => <tr key={k}><td>{FIX_KEY[k] ?? <Mono>{k}</Mono>}</td><td>{v}</td></tr>)}</tbody>
            </table>
          </div>
        ) : null}
        {tpl ? (
          <div>
            <p className="ui-micro">Instruction given for each failing record</p>
            <p className="ui-note">
              {tpl.split(/(\{[^}]+\})/).map((part, i) => (/^\{[^}]+\}$/.test(part)
                ? <FieldChip key={i} {...splitField(part.slice(1, -1))} />
                : <Fragment key={i}>{part}</Fragment>))}
            </p>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function History({ points, loading, neverRun }: { points: Awaited<ReturnType<typeof getFindings>>["findings"]; loading: boolean; neverRun: boolean }) {
  const router = useRouter();
  const series = [...points].reverse().filter((p) => p.pass_rate !== null);
  return (
    <SectionCard title="Pass rate per run" meta={series.length ? "Select a run to open it" : undefined}>
      {loading ? <TableSkeleton rows={3} label="Loading runs" /> : neverRun ? (
        <EmptyState action={<Link className="ui-link" href="/sync">Open sync</Link>}>No run has evaluated this rule yet.</EmptyState>
      ) : (
        <ScoreTrend ariaLabel="Pass rate per run" seriesLabel="Pass rate" height={220}
          points={series.map((p) => ({ label: formatDate(p.created_at), score: Math.round((p.pass_rate ?? 0) * 10) / 10, to: `/analyse/finding/${p.id}?v=${p.version_id}` }))}
          onPointClick={(i) => router.push(`/analyse/finding/${series[i].id}?v=${series[i].version_id}`)} />
      )}
    </SectionCard>
  );
}

function Records({ items, loading }: { items: RecordIssue[]; loading: boolean }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<RecordIssue, unknown>[]>(() => [
    { id: "key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "status", header: "Status", meta: meta({ width: 140 }), accessorFn: (i) => cap(labelOf(i.status)) },
    { id: "severity", header: "Severity", meta: meta({ width: 120 }), accessorFn: (i) => cap(String(i.severity ?? "")) },
  ], []);
  return (
    <SectionCard title="Failing records" flush>
      {loading ? <TableSkeleton rows={4} label="Loading records" /> : items.length === 0 ? (
        <EmptyState>No record is tracked as failing this rule.</EmptyState>
      ) : (
        <DataTable columns={columns} data={items} getRowId={(i) => i.id} ariaLabel="Failing records" maxHeight="320px"
          onRowActivate={(i) => router.push(`/workbench/record/${i.id}`)} />
      )}
    </SectionCard>
  );
}

function Changes({ r, data, loading }: { r: RuleDetail; data?: { version: number; state: string; note: string | null; created_by: string | null; created_at: string }[]; loading: boolean }) {
  return (
    <SectionCard title="Rule changes" flush={!!data?.length}>
      {!r.rule_uuid ? <EmptyState>This rule ships with Meridian and has not been stored for this tenant.</EmptyState>
        : loading ? <TableSkeleton rows={3} label="Loading changes" />
        : !data?.length ? <EmptyState>This rule has not been changed since it shipped.</EmptyState> : (
          <div className="ui-matrix-scroll">
            <table className="ui-mini-table">
              <thead><tr><th scope="col">Version</th><th scope="col">State</th><th scope="col">Changed</th><th scope="col">Note</th></tr></thead>
              <tbody>{data.map((v) => (
                <tr key={v.version}><td className="aurora-number">{v.version}</td><td>{cap(labelOf(v.state))}</td><td>{formatDate(v.created_at)}</td><td>{v.note ?? ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
    </SectionCard>
  );
}
