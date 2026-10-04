"use client";

/**
 * Rule register: every check the analysis runs, with its lifecycle. A rule
 * change is a draft version that a second person approves (four eyes); the
 * drawer shows the diff, the hit rate per run and what stewards marked as
 * false positives. Suppressions silence a rule or one record for a stated
 * reason and a bounded time.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, DiffView, EmptyState, Field, FilterBar, Input, KeyValue, Metric,
  MetricStrip, Mono, PageHeader, SectionCard, StatusBadge, Tabs, Textarea, TableSkeleton, useDrawerParam,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import {
  createRuleVersion, createSuppression, endSuppression, getRuleDiff, getRuleFeedback, getRuleHistory, getRuleVersions,
  getSuppressions, transitionRuleVersion, type RuleVersion, type RuleVersionState, type Suppression,
} from "@/lib/api/rule-lifecycle";
import { getRules, getRulesSummary, updateRule, type Rule } from "@/lib/api/rules";
import { formatModuleName, relativeTime } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const CATEGORIES = [
  { id: "ecc", label: "ECC" },
  { id: "successfactors", label: "SuccessFactors" },
  { id: "warehouse", label: "Warehouse" },
] as const;
type Category = (typeof CATEGORIES)[number]["id"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const sevStatus = (s: string): Status => ((SEVERITIES as readonly string[]).includes(s) ? (s as Status) : "low");
const checkId = (r: Rule) => r.name.split(":")[0];
const ruleTitle = (r: Rule) => r.name.includes(":") ? r.name.slice(r.name.indexOf(":") + 1).trim() : r.description;
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
const pct = (n?: number | null, digits = 1) => (n == null ? "—" : `${(n <= 1 ? n * 100 : n).toFixed(digits)}%`);
const STATE_LABEL: Record<RuleVersionState, string> = { draft: "Draft", in_review: "In review", active: "Active", retired: "Retired" };
const STATE_STATUS: Record<RuleVersionState, Status> = { draft: "idle", in_review: "running", active: "ok", retired: "low" };
const MAX_DAYS = 365;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function SettingsRulesPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const [tab, setTab] = useState<"rules" | "suppressions">("rules");
  const [category, setCategory] = useState<Category | undefined>();
  const [severity, setSeverity] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const drawer = useDrawerParam("rule");

  const summaryQ = useQuery({ queryKey: ["rules.summary"], queryFn: getRulesSummary });
  const rulesQ = useQuery({ queryKey: ["rules.list", { category }], queryFn: () => getRules({ category, limit: 200 }) });
  const feedbackQ = useQuery({ queryKey: ["rule-feedback"], queryFn: () => getRuleFeedback(), retry: false, meta: { ignoreError: true } });
  const suppressionsQ = useQuery({ queryKey: ["rule-suppressions", false], queryFn: () => getSuppressions(false), retry: false, meta: { ignoreError: true } });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRule(id, { enabled }),
    onSuccess: (_d, v) => {
      toast.success(v.enabled ? "Rule enabled" : "Rule disabled");
      qc.invalidateQueries({ queryKey: ["rules.list"] });
      qc.invalidateQueries({ queryKey: ["rules.summary"] });
    },
    onError: (e) => toast.error(`Rule not changed. ${apiErrorMessage(e)}`),
  });

  const totals = useMemo(() => {
    const t = { all: 0, enabled: 0, yaml: 0, hq: 0 };
    for (const row of summaryQ.data?.summary ?? []) {
      t.all += row.count;
      if (row.enabled) t.enabled += row.count;
      if (row.source === "yaml") t.yaml += row.count; else t.hq += row.count;
    }
    return t;
  }, [summaryQ.data]);

  const fpRate = useMemo(() => new Map((feedbackQ.data?.rules ?? []).map((r) => [r.check_id, r.false_positive_rate ?? null])), [feedbackQ.data]);
  const suppressions = suppressionsQ.data?.suppressions;
  const rules = rulesQ.data?.rules ?? [];
  const q = search.trim().toLowerCase();
  const visible = rules.filter((r) => (!severity || r.severity === severity)
    && (!q || [r.name, r.description, r.module, ...(r.tags ?? [])].join(" ").toLowerCase().includes(q)));
  const selected = rules.find((r) => r.id === drawer.value) ?? null;

  const columns = useMemo<ColumnDef<Rule>[]>(() => [
    { id: "check", header: "Check", meta: meta({ width: 110, mono: true }), accessorFn: checkId },
    { id: "rule", header: "Rule", meta: meta({ minWidth: 280 }), accessorFn: ruleTitle, cell: ({ row }) => (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main">{ruleTitle(row.original)}</span>
        {row.original.description && row.original.description !== ruleTitle(row.original)
          ? <span className="ui-cell-stack__sub">{row.original.description}</span> : null}
      </span>
    ) },
    { id: "module", header: "Object", meta: meta({ width: 160 }), accessorFn: (r) => formatModuleName(r.module) },
    { id: "severity", header: "Severity", meta: meta({ width: 110 }), accessorFn: (r) => SEVERITIES.indexOf(r.severity as never),
      cell: ({ row }) => <StatusBadge status={sevStatus(row.original.severity)} /> },
    { id: "fp", header: "False positives", meta: meta({ width: 120, align: "end", numeric: true }),
      accessorFn: (r) => fpRate.get(checkId(r)) ?? -1, cell: ({ row }) => pct(fpRate.get(checkId(row.original)), 0) },
    { id: "source", header: "Source", meta: meta({ width: 110 }), accessorFn: (r) => r.source === "yaml" ? "Rule pack" : "HQ" },
    { id: "enabled", header: "Runs", meta: meta({ width: 80 }), accessorFn: (r) => (r.enabled ? 1 : 0), cell: ({ row }) => (
      <label className="ui-check" data-disabled={!can("manage_rules")} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={row.original.enabled} disabled={!can("manage_rules") || toggle.isPending}
          aria-label={`Run ${checkId(row.original)}`}
          onChange={(e) => toggle.mutate({ id: row.original.id, enabled: e.target.checked })} />
        {row.original.enabled ? "On" : "Off"}
      </label>
    ) },
  ], [fpRate, can, toggle]);

  const filtering = !!(category || severity || q);

  return (
    <div className="ui-page">
      <PageHeader
        title="Rules"
        summary={summaryQ.data
          ? `${totals.all.toLocaleString()} rules, ${totals.enabled.toLocaleString()} running. ${totals.yaml.toLocaleString()} from the shipped rule pack, ${totals.hq.toLocaleString()} pushed from HQ.`
          : undefined}
        actions={can("manage_rules") ? <Link className="ui-link" href="/ai/rules">Draft a rule from a description</Link> : null}
      />

      <MetricStrip label="Rule counts">
        <Metric label="Rules" value={summaryQ.data ? totals.all.toLocaleString() : "—"} />
        <Metric label="Running" value={summaryQ.data ? totals.enabled.toLocaleString() : "—"} />
        <Metric label="Switched off" value={summaryQ.data ? (totals.all - totals.enabled).toLocaleString() : "—"} />
        <Metric label="Active suppressions" value={suppressions ? suppressions.filter((s) => s.active !== false).length.toLocaleString() : "—"} />
      </MetricStrip>

      <Tabs ariaLabel="Rules and suppressions" value={tab} onValueChange={(v) => setTab(v as typeof tab)}
        items={[{ id: "rules", label: "Rules", count: rulesQ.data?.total }, { id: "suppressions", label: "Suppressions", count: suppressions?.length }]} />

      {tab === "rules" ? (
        <>
          <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search rules" }}
            onClear={filtering ? () => { setCategory(undefined); setSeverity(undefined); setSearch(""); } : undefined}>
            {CATEGORIES.map((c) => (
              <Chip key={c.id} selected={category === c.id} onClick={() => setCategory(category === c.id ? undefined : c.id)}>{c.label}</Chip>
            ))}
            {SEVERITIES.map((s) => (
              <Chip key={s} selected={severity === s} onClick={() => setSeverity(severity === s ? undefined : s)}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Chip>
            ))}
          </FilterBar>

          {rulesQ.isLoading ? <TableSkeleton rows={10} label="Loading rules" />
            : rulesQ.error ? <Banner tone="danger" title="Rules could not be read">{apiErrorMessage(rulesQ.error)}</Banner>
            : visible.length ? (
              <DataTable columns={columns} data={visible} getRowId={(r) => r.id} onRowActivate={(r) => drawer.open(r.id)}
                ariaLabel="Rules. Use j and k to move, Enter to open." maxHeight="62vh" sortable />
            ) : (
              <EmptyState action={filtering
                ? <button type="button" className="ui-link-button" onClick={() => { setCategory(undefined); setSeverity(undefined); setSearch(""); }}>Clear filters</button>
                : undefined}>
                {filtering ? "No rules match these filters." : "No rules are loaded. Rules ship with the rule pack and appear after the first start."}
              </EmptyState>
            )}
        </>
      ) : (
        <SuppressionsPanel />
      )}

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Rule details"
        header={selected ? (
          <div className="ui-drawer-head">
            <StatusBadge status={sevStatus(selected.severity)} />
            <h2 className="ui-drawer-head__title"><Mono>{checkId(selected)}</Mono> {ruleTitle(selected)}</h2>
          </div>) : null}>
        {selected ? <RuleDetail rule={selected} /> : null}
      </DetailDrawer>
    </div>
  );
}

/* ── Drawer ────────────────────────────────────────────────────────── */

function RuleDetail({ rule }: { rule: Rule }) {
  const [tab, setTab] = useState<"versions" | "history" | "feedback">("versions");
  const id = checkId(rule);
  return (
    <div className="ui-detail">
      {rule.description ? <p className="ui-note">{rule.description}</p> : null}
      <KeyValue rows={[
        { k: "Check", v: id, mono: true },
        { k: "Object", v: formatModuleName(rule.module) },
        { k: "Severity", v: <StatusBadge status={sevStatus(rule.severity)} /> },
        { k: "Source", v: rule.source === "yaml" ? "Shipped rule pack" : "Pushed from HQ" },
        { k: "Runs", v: rule.enabled ? "Yes" : "No, switched off" },
        { k: "Changed", v: relativeTime(rule.updated_at) },
      ]} />
      <Tabs ariaLabel="Rule lifecycle" value={tab} onValueChange={(v) => setTab(v as typeof tab)}
        items={[{ id: "versions", label: "Versions" }, { id: "history", label: "Hit rate" }, { id: "feedback", label: "Feedback" }]} />
      {tab === "versions" ? <Versions checkId={id} fallbackBody={rule} />
        : tab === "history" ? <History checkId={id} /> : <Feedback checkId={id} />}
      <SuppressForm checkId={id} />
    </div>
  );
}

function Versions({ checkId: id, fallbackBody }: { checkId: string; fallbackBody: Rule }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const { user } = useAuth();
  const [diffFor, setDiffFor] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["rule-versions", id], queryFn: () => getRuleVersions(id), retry: false, meta: { ignoreError: true } });
  const diff = useQuery({ queryKey: ["rule-diff", id, diffFor], enabled: diffFor !== null, queryFn: () => getRuleDiff(id, diffFor!) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rule-versions", id] });

  const move = useMutation({
    mutationFn: (v: { version: number; to: RuleVersionState }) => transitionRuleVersion(id, v.version, v.to),
    onSuccess: (_d, v) => { toast.success(`Version ${v.version} is now ${STATE_LABEL[v.to].toLowerCase()}`); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => createRuleVersion(id, body, note.trim() || undefined),
    onSuccess: () => { toast.success("Draft saved"); setEditing(null); setNote(""); refresh(); },
    onError: (e) => toast.error(`Draft not saved. ${apiErrorMessage(e)}`),
  });

  if (q.isLoading) return <TableSkeleton rows={3} label="Loading versions" />;
  if (q.error) return <Banner tone="danger" title="Versions could not be read">{apiErrorMessage(q.error)}</Banner>;
  if (!q.data) return <EmptyState>Rule versions are not available on this server. Changes apply directly.</EmptyState>;

  const versions = [...(q.data.versions ?? [])].sort((a, b) => b.version - a.version);
  const base = versions[0]?.body ?? q.data.shipped?.rule ?? { conditions: fallbackBody.conditions, thresholds: fallbackBody.thresholds };
  const mine = (v: RuleVersion) => !!user && (v.created_by === user.id || v.created_by === user.email);
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  if (editing !== null) {
    try { parsed = JSON.parse(editing); } catch (e) { parseError = (e as Error).message; }
  }

  return (
    <div className="ui-stack" style={{ gap: "var(--aurora-space-4)" }}>
      {q.data.shipped ? (
        <p className="ui-note">Shipped with {q.data.shipped.app_version ? `release ${q.data.shipped.app_version}` : "the rule pack"}
          {q.data.shipped.hash ? <> as <Mono>{q.data.shipped.hash.slice(0, 12)}</Mono></> : null}. Tenant versions below override it once approved.</p>
      ) : null}

      {versions.length ? (
        <table className="ui-mini-table">
          <thead><tr><th>Version</th><th>State</th><th>Author</th><th>Changed</th><th><span className="ui-visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {versions.map((v) => {
              const state = v.state ?? "draft";
              return (
                <tr key={v.version}>
                  <td className="ui-num">{v.version}</td>
                  <td><StatusBadge status={STATE_STATUS[state]}>{STATE_LABEL[state]}</StatusBadge></td>
                  <td>
                    <span className="ui-cell-stack">
                      <span className="ui-cell-stack__main">{v.created_by ?? "—"}</span>
                      {v.approved_by ? <span className="ui-cell-stack__sub">Approved by {v.approved_by}</span> : null}
                    </span>
                  </td>
                  <td>{day(v.updated_at ?? v.created_at)}</td>
                  <td>
                    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: "var(--aurora-space-1)" }}>
                      <Button size="sm" variant="ghost" onClick={() => setDiffFor(diffFor === v.version ? null : v.version)}>
                        {diffFor === v.version ? "Hide diff" : "Diff"}
                      </Button>
                      {state === "draft" && can("manage_rules")
                        ? <Button size="sm" variant="secondary" disabled={move.isPending} onClick={() => move.mutate({ version: v.version, to: "in_review" })}>Send for review</Button> : null}
                      {state === "in_review" && can("approve") ? (
                        <>
                          <Button size="sm" disabled={move.isPending || mine(v)} title={mine(v) ? "The author cannot approve their own version." : undefined}
                            onClick={() => move.mutate({ version: v.version, to: "active" })}>Approve</Button>
                          <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ version: v.version, to: "draft" })}>Send back</Button>
                        </>
                      ) : null}
                      {state === "active" && can("manage_rules")
                        ? <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ version: v.version, to: "retired" })}>Retire</Button> : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="ui-note">No tenant versions. The shipped rule runs as is.</p>}

      {versions.some((v) => v.state === "in_review" && mine(v)) ? (
        <p className="ui-micro">A version you wrote needs another approver. The author cannot approve their own version.</p>
      ) : null}

      {diffFor !== null ? (
        diff.isLoading ? <TableSkeleton rows={4} label="Loading diff" />
          : diff.error ? <Banner tone="danger" title="Diff could not be read">{apiErrorMessage(diff.error)}</Banner>
          : diff.data?.diff ? <DiffView diff={diff.data.diff} label={`Changes in version ${diffFor}`} />
          : <p className="ui-note">Version {diffFor} has no changes against {diff.data?.from ? `version ${diff.data.from}` : "the shipped rule"}.</p>
      ) : null}

      {can("manage_rules") ? (
        editing === null ? (
          <div><Button variant="secondary" onClick={() => setEditing(JSON.stringify(base, null, 2))}>New draft version</Button></div>
        ) : (
          <form className="ui-form" onSubmit={(e) => { e.preventDefault(); if (parsed) create.mutate(parsed); }}>
            <Field label="Rule body (JSON)" error={parseError} helper="Starts from the latest version. A draft runs nowhere until someone else approves it.">
              {({ controlId, helperId }) => (
                <Textarea id={controlId} aria-describedby={helperId} rows={12} className="ui-code" spellCheck={false}
                  invalid={!!parseError} value={editing} onChange={(e) => setEditing(e.target.value)} />
              )}
            </Field>
            <Field label="What changed and why">
              {({ controlId }) => <Input id={controlId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="ui-form__actions">
              <Button type="submit" disabled={!parsed || create.isPending}>Save draft</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Discard</Button>
            </div>
          </form>
        )
      ) : null}
    </div>
  );
}

function History({ checkId: id }: { checkId: string }) {
  const q = useQuery({ queryKey: ["rule-history", id], queryFn: () => getRuleHistory(id, 30), retry: false, meta: { ignoreError: true } });
  if (q.isLoading) return <TableSkeleton rows={4} label="Loading hit rate" />;
  if (q.error) return <Banner tone="danger" title="Hit rate could not be read">{apiErrorMessage(q.error)}</Banner>;
  const runs = q.data?.runs ?? [];
  if (!q.data) return <EmptyState>Hit-rate history is not available on this server.</EmptyState>;
  if (!runs.length) return <EmptyState>This rule has not run yet.</EmptyState>;
  return (
    <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
      <p className="ui-note">Share of checked records the rule flagged in each run, newest first. A sudden rise after a version change usually means the rule, not the data, moved.</p>
      <table className="ui-mini-table">
        <thead><tr><th>Run</th><th className="ui-num">Flagged</th><th className="ui-num">Checked</th><th className="ui-num">Hit rate</th><th className="ui-num">Suppressed</th></tr></thead>
        <tbody>
          {runs.map((r, i) => (
            <tr key={`${r.version_id}-${i}`}>
              <td>{day(r.run_at)}</td>
              <td className="ui-num">{r.affected_count?.toLocaleString() ?? "—"}</td>
              <td className="ui-num">{r.total_count?.toLocaleString() ?? "—"}</td>
              <td className="ui-num">{pct(r.hit_rate, 2)}</td>
              <td className="ui-num">{r.suppressed?.toLocaleString() ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Feedback({ checkId: id }: { checkId: string }) {
  const q = useQuery({ queryKey: ["rule-feedback", id], queryFn: () => getRuleFeedback(id), retry: false, meta: { ignoreError: true } });
  if (q.isLoading) return <TableSkeleton rows={3} label="Loading feedback" />;
  if (q.error) return <Banner tone="danger" title="Feedback could not be read">{apiErrorMessage(q.error)}</Banner>;
  if (!q.data) return <EmptyState>Steward feedback is not available on this server.</EmptyState>;
  const row = q.data.rules?.find((r) => r.check_id === id);
  if (!row?.flagged) return <EmptyState>No steward has marked a finding from this rule yet.</EmptyState>;
  return (
    <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
      <KeyValue rows={[
        { k: "Findings reviewed", v: row.flagged.toLocaleString() },
        { k: "Marked not an issue", v: (row.false_positive ?? 0).toLocaleString() },
        { k: "Confirmed real", v: (row.real ?? 0).toLocaleString() },
        { k: "False-positive rate", v: pct(row.false_positive_rate) },
      ]} />
      {q.data.reasons?.length ? (
        <>
          <h3 className="ui-detail-part__title">Reasons stewards gave</h3>
          <table className="ui-mini-table">
            <thead><tr><th>Reason</th><th className="ui-num">Records</th><th>Last</th></tr></thead>
            <tbody>{q.data.reasons.map((r) => (
              <tr key={r.reason}><td style={{ whiteSpace: "normal" }}>{r.reason}</td><td className="ui-num">{r.records?.toLocaleString() ?? "—"}</td><td>{day(r.last_at)}</td></tr>
            ))}</tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

function SuppressForm({ checkId: id }: { checkId: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const [open, setOpen] = useState(false);
  const [recordKey, setRecordKey] = useState("");
  const [reason, setReason] = useState("");
  const today = new Date();
  const max = isoDay(new Date(today.getTime() + MAX_DAYS * 86_400_000));
  const [expires, setExpires] = useState(isoDay(new Date(today.getTime() + 90 * 86_400_000)));
  const save = useMutation({
    mutationFn: () => createSuppression({ check_id: id, record_key: recordKey.trim() || undefined, reason: reason.trim(),
      expires_at: new Date(`${expires}T23:59:59Z`).toISOString() }),
    onSuccess: () => {
      toast.success(recordKey.trim() ? "Record suppressed" : "Rule suppressed");
      setOpen(false); setReason(""); setRecordKey("");
      qc.invalidateQueries({ queryKey: ["rule-suppressions"] });
    },
    onError: (e) => toast.error(`Not suppressed. ${apiErrorMessage(e)}`),
  });
  if (!can("approve")) return null;
  const tooLate = expires > max || expires <= isoDay(today);
  return (
    <div className="ui-detail-part">
      <h3 className="ui-detail-part__title">Suppress</h3>
      {!open ? (
        <>
          <p className="ui-note">Stop this rule from raising findings, for every record or one record key, until a set date.</p>
          <div><Button variant="secondary" onClick={() => setOpen(true)}>Suppress this rule</Button></div>
        </>
      ) : (
        <form className="ui-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Record key" helper="Leave empty to suppress the rule for every record.">
            {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} className="ui-mono" value={recordKey} onChange={(e) => setRecordKey(e.target.value)} />}
          </Field>
          <Field label="Reason" required helper="Recorded in the audit log and shown to stewards.">
            {({ controlId, helperId }) => <Textarea id={controlId} aria-describedby={helperId} rows={3} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Field label="Ends on" required error={tooLate ? `Pick a date after today and no later than ${day(max)}.` : undefined} helper={`At most ${MAX_DAYS} days ahead.`}>
            {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} type="date" min={isoDay(new Date(today.getTime() + 86_400_000))} max={max}
              invalid={tooLate} value={expires} onChange={(e) => setExpires(e.target.value)} />}
          </Field>
          <div className="ui-form__actions">
            <Button type="submit" disabled={reason.trim().length < 3 || tooLate || save.isPending}>Suppress</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ── Suppressions tab ──────────────────────────────────────────────── */

function SuppressionsPanel() {
  const qc = useQueryClient();
  const { can } = useRole();
  const [expired, setExpired] = useState(false);
  const q = useQuery({ queryKey: ["rule-suppressions", expired], queryFn: () => getSuppressions(expired), retry: false, meta: { ignoreError: true } });
  const end = useMutation({
    mutationFn: (id: string) => endSuppression(id),
    onSuccess: () => { toast.success("Suppression ended"); qc.invalidateQueries({ queryKey: ["rule-suppressions"] }); },
    onError: (e) => toast.error(`Suppression not ended. ${apiErrorMessage(e)}`),
  });
  const columns = useMemo<ColumnDef<Suppression>[]>(() => [
    { id: "check", header: "Check", meta: meta({ width: 110, mono: true }), accessorKey: "check_id" },
    { id: "key", header: "Record", meta: meta({ width: 160 }), accessorFn: (s) => s.record_key ?? "",
      cell: ({ row }) => row.original.record_key ? <Mono>{row.original.record_key}</Mono> : "Every record" },
    { id: "reason", header: "Reason", meta: meta({ minWidth: 240 }), accessorFn: (s) => s.reason ?? "—" },
    { id: "by", header: "By", meta: meta({ width: 160 }), accessorFn: (s) => s.created_by ?? "—" },
    { id: "ends", header: "Ends", meta: meta({ width: 120 }), accessorFn: (s) => s.expires_at ?? "", cell: ({ row }) => day(row.original.expires_at) },
    { id: "state", header: "State", meta: meta({ width: 100 }), accessorFn: (s) => (s.active === false ? 0 : 1),
      cell: ({ row }) => <StatusBadge status={row.original.active === false ? "idle" : "ok"}>{row.original.active === false ? "Ended" : "Active"}</StatusBadge> },
    { id: "act", header: "", meta: meta({ width: 100, align: "end" }), cell: ({ row }) => row.original.active !== false && can("approve")
      ? <Button size="sm" variant="ghost" disabled={end.isPending} onClick={() => end.mutate(row.original.id)}>End now</Button> : null },
  ], [can, end]);

  if (q.isLoading) return <TableSkeleton rows={6} label="Loading suppressions" />;
  if (q.error) return <Banner tone="danger" title="Suppressions could not be read">{apiErrorMessage(q.error)}</Banner>;
  if (!q.data) return <EmptyState>Suppressions are not available on this server.</EmptyState>;
  const rows = q.data.suppressions ?? [];
  return (
    <SectionCard title="Suppressions" meta={`${rows.length} ${expired ? "in total" : "active"}`} flush
      action={<label className="ui-check"><input type="checkbox" checked={expired} onChange={(e) => setExpired(e.target.checked)} />Show ended</label>}>
      {rows.length ? <DataTable columns={columns} data={rows} getRowId={(s) => s.id} ariaLabel="Suppressions" maxHeight="56vh" sortable />
        : <EmptyState>No rule is suppressed. Open a rule to suppress it with a reason and an end date.</EmptyState>}
    </SectionCard>
  );
}
