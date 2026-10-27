"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, ErrorState, Input, Mono, Notice, Pill, Select, SeverityDot, Skeleton, Textarea, isSeverity } from "@/design";
import { decide, getWorkRecord, type Decision, type WorkAllowedValue, type WorkIssue, type WorkRecordDetail } from "@/lib/api/work";
import { updateIssues } from "@/lib/api/issues";
import { getAssignableUsers } from "@/lib/api/users";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName, formatMoney, formatNumber, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { SOURCE, STATUS, dueLabel } from "./status";

export const workRecordKey = (module: string, key: string, run?: string) => ["work", "record", module, key, run ?? "latest"];

/** A value as the record holds it: blank and missing are shown, never an empty cell. */
export function Value({ v }: { v: string | null | undefined }) {
  if (v === null || v === undefined) return <span className="m-ink-3 italic">missing</span>;
  if (v.trim() === "") return <span className="m-ink-3 italic">blank</span>;
  return <Mono inline>{v}</Mono>;
}

/** The anchor of an issue on the panel: the full record page's fields jump to it. */
export const issueAnchor = (checkId: string) => `issue-${checkId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** The rule's page: the tenant's rule library row when there is one, else the rule on the object for the run. */
export function ruleHref(issue: WorkIssue, module: string, run: string | undefined): string {
  if (issue.rule?.id) return `/rules/${encodeURIComponent(issue.rule.id)}`;
  return `/objects/${encodeURIComponent(module)}/rules/${encodeURIComponent(issue.check_id)}${run ? `?run=${encodeURIComponent(run)}` : ""}`;
}

/** Fix work filtered to every record that fails the same check. */
export function sameIssueHref(checkId: string, module: string, run: string | undefined): string {
  const q = new URLSearchParams({ check: checkId, module });
  if (run) q.set("run", run);
  return `/fix?${q.toString()}`;
}

const LINK = "m-ink-accent underline underline-offset-2";
const TIMES = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${formatNumber(n)} times`);
const SLA: Record<string, string> = { on_track: "on track", at_risk: "at risk", breached: "past its SLA", paused: "SLA paused" };
const pct = (n: number) => formatNumber(n, { maximumFractionDigits: 1 });

/** "Fails in 1,204 of 25,000 records (95.2% pass)", or without a population "Fails in 1,204 records". */
export function populationLine(issue: Pick<WorkIssue, "failing" | "population" | "pass_rate">): string | null {
  if (issue.failing === undefined) return null;
  if (!issue.population) return `Fails in ${plural(issue.failing, "record")}`;
  const pass = issue.pass_rate === null || issue.pass_rate === undefined ? "" : ` (${pct(issue.pass_rate)}% pass)`;
  return `Fails in ${formatNumber(issue.failing)} of ${plural(issue.population, "record")}${pass}`;
}

/** "First seen 12 Oct 2026, reopened twice", "Due 1 Nov 2026, on track"; null when there is nothing to say. */
export function historyLine(issue: Pick<WorkIssue, "first_seen_at" | "reopened_count" | "due_at" | "sla_state">): string | null {
  const parts: string[] = [];
  if (issue.first_seen_at) parts.push(`First seen ${formatDate(issue.first_seen_at)}`);
  if (issue.reopened_count > 0) parts.push(parts.length ? `reopened ${TIMES(issue.reopened_count)}` : `Reopened ${TIMES(issue.reopened_count)}`);
  const head = parts.join(", ");
  const due = issue.due_at ? `Due ${formatDate(issue.due_at)}${issue.sla_state && SLA[issue.sla_state] ? `, ${SLA[issue.sla_state]}` : ""}` : null;
  return [head, due].filter(Boolean).join(". ") || null;
}

/** "Last run: 3 issues, now 2", with what was fixed and what is new since. */
export function lastRunLine(rec: Pick<WorkRecordDetail, "other_runs" | "issues">): string | null {
  const o = rec.other_runs;
  if (!o) return null;
  const now = rec.issues.length;
  const head = o.on_list ? `Last run: ${plural(o.issues, "issue")}, now ${formatNumber(now)}` : `Last run: passing, now ${plural(now, "issue")}`;
  const since = [o.on_list && o.fixed_since.length ? `${formatNumber(o.fixed_since.length)} fixed since` : "",
    o.on_list && o.new_since.length ? `${formatNumber(o.new_since.length)} new` : ""].filter(Boolean).join(", ");
  return since ? `${head} (${since})` : head;
}

const INLINE_VALUES = 8;

function AllowedValues({ values, onUse, field }: { values: WorkAllowedValue[]; onUse?: (v: string) => void; field: string }) {
  const chips = (list: WorkAllowedValue[]) => (
    <ul className="flex flex-wrap gap-1.5" aria-label={`Allowed values for ${field}`}>
      {list.map((v) => (
        <li key={v.value} className="inline-flex max-w-full items-center gap-1.5 rounded-[var(--m-radius-pill)] border border-[var(--m-line)] bg-[var(--m-sheet-raised)] py-0.5 pl-2 pr-1 m-text-meta">
          <Value v={v.value} />
          {v.label ? <span className="truncate m-ink-3">{v.label}</span> : null}
          {onUse ? (
            <button type="button" onClick={() => onUse(v.value)} aria-label={`Use ${v.value.trim() ? v.value : "blank"}`}
              className="rounded-[var(--m-radius-pill)] px-1.5 m-ink-accent hover:[background:var(--m-accent-soft)] focus-visible:[box-shadow:var(--m-elev-focus)]">Use</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
  if (values.length <= INLINE_VALUES) {
    return (
      <div className="flex flex-col gap-1">
        <span className="m-text-meta m-ink-3">Allowed values</span>
        {chips(values)}
      </div>
    );
  }
  return (
    <details className="m-text-body">
      <summary className="cursor-pointer m-ink-accent">Allowed values ({formatNumber(values.length)})</summary>
      <div className="mt-2">{chips(values)}</div>
    </details>
  );
}

function IssueFacts({ issue, rec, run }: { issue: WorkIssue; rec: WorkRecordDetail; run: string | undefined }) {
  const history = historyLine(issue);
  const population = populationLine(issue);
  const rule = issue.rule;
  const cost = rule?.cost_per_record ?? null;
  const total = rule?.cost_at_risk ?? null;
  const dimension = rule?.dimension ?? issue.dimension;
  const sameIssue = <Link href={sameIssueHref(issue.check_id, rec.module, run)} className={LINK}>Every record with this issue</Link>;
  return (
    <div className="flex flex-col gap-0.5 m-text-meta m-ink-3" data-testid="issue-facts">
      <p>
        Rule <Link href={ruleHref(issue, rec.module, run)} className={LINK}>{rule?.name ?? issue.check_id}</Link>
        {dimension ? <>, {dimension}</> : null}
      </p>
      <p>
        {population ? <>{population}. </> : null}
        {issue.others_failing === 0 ? "No other record fails it" : sameIssue}
      </p>
      {history ? <p>{history}</p> : null}
      {cost !== null ? (
        <p>{formatMoney(cost, rec.currency)} at risk on this record{total !== null ? `, ${formatMoney(total, rec.currency)} across the rule` : ""}</p>
      ) : null}
    </div>
  );
}

/** The record beyond this run: the previous run, its golden record and its open duplicate candidates. */
function RecordContext({ rec }: { rec: WorkRecordDetail }) {
  const last = lastRunLine(rec);
  const dup = rec.duplicates && rec.duplicates.open > 0 ? rec.duplicates : null;
  if (!last && !rec.golden_record && !dup) return null;
  return (
    <ul className="flex flex-col gap-1 m-text-body m-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-4" data-testid="record-context">
      {last ? <li>{last}{rec.other_runs?.run_at ? <span className="m-text-meta m-ink-3">, run of {formatDate(rec.other_runs.run_at)}</span> : null}</li> : null}
      {rec.golden_record ? (
        <li><Link href={rec.golden_record.href} className={LINK}>Golden record</Link>{rec.golden_record.status !== "golden" ? <span className="m-ink-3"> ({rec.golden_record.status.replace(/_/g, " ")})</span> : null}</li>
      ) : null}
      {dup ? <li><Link href={dup.href} className={LINK}>{plural(dup.open, "open duplicate candidate")}</Link></li> : null}
    </ul>
  );
}

/** Where a proposed fix waits: the draft batch under Fix › Batches and export (approved in Inbox › Approvals). */
export const DRAFT_BATCH_HREF = "/fix?tab=batches";

/** A "waits in your draft batch" toast with the way there. A Link (styled as the toast button) needs no router. */
export function toastDraftBatch(message: string): void {
  toast.success(message, { action: <Link href={DRAFT_BATCH_HREF} data-button="">Open draft batch</Link> });
}

/** Everything a work decision changes: the work list, the draft batches, the rail counts and the steward home's tasks. */
export function invalidateAfterDecision(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["work"] });
  void qc.invalidateQueries({ queryKey: queryKeys.remediationBatches() });
  void qc.invalidateQueries({ queryKey: queryKeys.shellCounts() });
  void qc.invalidateQueries({ queryKey: ["home-inbox-top"] });
}

function useDecide(module: string, recordKey: string, run: string | undefined, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Decision[]) => decide(items, run),
    onSuccess: (r, items) => {
      const a = items[0]?.action;
      const said = a === "undo" ? "Decision undone" : a === "assign" ? "Assignment saved" : a === "comment" ? "Comment added"
        : a === "not_an_issue" || a === "accept_risk" ? "Signed off" : null;
      if (said) toast.success(said);
      else toastDraftBatch("Fix proposed: it waits in your draft batch for approval");
      invalidateAfterDecision(qc);
      if (r.updated > 0 && a !== "comment" && a !== "assign") onDone?.();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

type SignOff = "not_an_issue" | "accept_risk";

/**
 * "Fixed in SAP": the record was corrected in SAP itself, outside a batch. The issue closes as fixed at the source
 * (record_issues resolution fixed_in_source, which needs `assign`, as the retired Inbox › Issues tab did); the next
 * run reopens it if the record still fails.
 */
function useFixedInSap(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) => updateIssues({ ids: [issueId], status: "resolved", resolution: "fixed_in_source" }),
    onSuccess: () => { toast.success("Marked fixed in SAP: the next run confirms it"); invalidateAfterDecision(qc); onDone?.(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

function IssueCard({ issue, rec, run, onDecided, editing, setEditing }: {
  issue: WorkIssue; rec: WorkRecordDetail; run: string | undefined; onDecided?: () => void;
  editing: boolean; setEditing: (on: boolean) => void;
}) {
  const [value, setValue] = useState(issue.suggestion?.value ?? "");
  const [signOff, setSignOff] = useState<SignOff | null>(null);
  const [reason, setReason] = useState("");
  const m = useDecide(rec.module, rec.record_key, run, onDecided);
  const fixedInSap = useFixedInSap(onDecided);
  const base = { module: rec.module, record_key: rec.record_key, check_id: issue.check_id };
  const open = issue.status === "to_fix";
  const decided = issue.decision && issue.status !== "fixed" && issue.status !== "not_an_issue";
  const due = open ? dueLabel(issue.due_at) : null;
  const sev = isSeverity(issue.severity) ? issue.severity : "low";
  const canEdit = rec.can.fix && (open || issue.status === "proposed");
  return (
    <section id={issueAnchor(issue.check_id)} aria-label={issue.message} className="flex scroll-mt-24 flex-col gap-3 border-b border-[var(--m-line)] pb-4 last:border-b-0 last:pb-0" data-testid="work-issue">
      <header className="flex flex-wrap items-start gap-2">
        <SeverityDot severity={sev} />
        <div className="min-w-0 flex-1">
          <p className="m-text-body font-medium m-ink">{issue.message}</p>
          <p className="m-text-meta m-ink-3">{issue.field ? <Mono inline>{issue.field}</Mono> : null} <Mono inline>{issue.check_id}</Mono></p>
        </div>
        {/* The record's status sits once in the panel's header; an issue repeats it only where it differs. */}
        {issue.status !== rec.status ? <Pill tone={STATUS[issue.status].tone}>{STATUS[issue.status].label}</Pill> : null}
        {due ? <Pill tone={due.tone}>{due.label}</Pill> : null}
      </header>
      <IssueFacts issue={issue} rec={rec} run={run} />

      <dl className="grid grid-cols-[minmax(96px,max-content)_1fr] gap-x-3 gap-y-1 m-text-body">
        <dt className="m-ink-3">Now</dt>
        <dd><Value v={issue.current_value} /></dd>
        {issue.suggestion ? (
          <>
            <dt className="m-ink-3">Suggested</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Value v={issue.suggestion.value} />
              <span className="m-text-meta m-ink-3">{SOURCE[issue.suggestion.source]}{issue.suggestion.confidence ? `, ${issue.suggestion.confidence} confidence` : ""}</span>
            </dd>
          </>
        ) : null}
        {decided && issue.decision ? (
          <>
            <dt className="m-ink-3">Decided</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Value v={issue.decision.value} />
              <span className="m-text-meta m-ink-3">in {issue.decision.batch_name}{issue.decision.at ? `, ${formatDate(issue.decision.at, "datetime")}` : ""}</span>
            </dd>
          </>
        ) : null}
      </dl>
      {issue.decision?.still_failing ? (
        <Notice tone="warning">This value was sent to SAP, but the latest run still finds the record failing. Check the load, or propose another value.</Notice>
      ) : null}
      {issue.instruction ? <p className="m-text-body m-ink-2">{issue.instruction}</p> : null}
      {issue.allowed_values?.length ? (
        <AllowedValues values={issue.allowed_values} field={issue.field ?? issue.check_id}
          onUse={canEdit ? (v) => { setSignOff(null); setValue(v); setEditing(true); } : undefined} />
      ) : null}
      {issue.why_it_matters || issue.sap_impact ? (
        <details className="m-text-body m-ink-2">
          <summary className="cursor-pointer m-ink-accent">Why it matters</summary>
          {issue.why_it_matters ? <p className="mt-1">{issue.why_it_matters}</p> : null}
          {issue.sap_impact ? <p className="mt-1">In SAP: {issue.sap_impact}</p> : null}
        </details>
      ) : null}

      {canEdit ? (
        editing ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) m.mutate([{ ...base, action: "edit", value }]); }}>
            <Input aria-label={`New value for ${issue.field ?? issue.check_id}`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus className="m-input min-w-[200px] flex-1" />
            <Button type="submit" pending={m.isPending} disabled={!value.trim()}>Save value</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Keep as is</Button>
          </form>
        ) : signOff ? (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) m.mutate([{ ...base, action: signOff, note: reason }]); }}>
            <Textarea aria-label="Reason" placeholder={signOff === "not_an_issue" ? "Why is this not an issue?" : "Why is the risk acceptable?"} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus rows={2} />
            <div className="flex gap-2">
              <Button type="submit" pending={m.isPending} disabled={!reason.trim()}>{signOff === "not_an_issue" ? "Mark not an issue" : "Accept the risk"}</Button>
              <Button type="button" variant="ghost" onClick={() => setSignOff(null)}>Keep it open</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {issue.suggestion && open ? <Button pending={m.isPending} onClick={() => m.mutate([{ ...base, action: "accept" }])}>Accept {issue.suggestion.value.trim() ? `"${issue.suggestion.value}"` : "suggestion"}</Button> : null}
            <Button variant={issue.suggestion && open ? "secondary" : "primary"} onClick={() => { setValue(issue.decision?.value ?? issue.suggestion?.value ?? issue.current_value ?? ""); setEditing(true); }}>{decided ? "Change value" : "Enter value"}</Button>
            {rec.can.sign_off && open ? <Button variant="ghost" onClick={() => setSignOff("not_an_issue")}>Not an issue</Button> : null}
            {rec.can.sign_off && open ? <Button variant="ghost" onClick={() => setSignOff("accept_risk")}>Accept risk</Button> : null}
            {rec.can.assign && open && issue.issue_id ? <Button variant="ghost" pending={fixedInSap.isPending} onClick={() => issue.issue_id && fixedInSap.mutate(issue.issue_id)}>Fixed in SAP</Button> : null}
            {decided && issue.status === "proposed" ? <Button variant="ghost" pending={m.isPending} onClick={() => m.mutate([{ ...base, action: "undo" }])}>Undo</Button> : null}
          </div>
        )
      ) : null}
      {rec.can.sign_off && issue.status === "not_an_issue" ? (
        <div><Button variant="ghost" pending={m.isPending} onClick={() => m.mutate([{ ...base, action: "undo", note: "Sign-off withdrawn" }])}>Withdraw sign-off</Button></div>
      ) : null}
    </section>
  );
}

/** Colleagues a record can be handed to: everyone assignable but its current assignee. */
function assignees(list: Awaited<ReturnType<typeof getAssignableUsers>> | undefined, current: string | null): { value: string; label: string }[] {
  return (Array.isArray(list) ? list : [])
    .filter((u) => u.id !== current)
    .map((u) => ({ value: u.id, label: u.name || u.email }));
}

const EVENT: Record<string, string> = { status: "Status", assign: "Assigned", comment: "Comment", auto_resolved: "Fixed by a run", reopened: "Failed again" };

function History({ rec }: { rec: WorkRecordDetail }) {
  if (!rec.events.length) return <p className="m-text-body m-ink-3">No activity yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {rec.events.map((e, i) => (
        <li key={i} className="m-text-body">
          <span className="m-ink">{EVENT[e.action] ?? e.action}</span>
          {e.to_value && e.action === "status" ? <span className="m-ink-2"> to {STATUS_LABEL(e.to_value)}</span> : null}
          {e.note ? <span className="m-ink-2">: {e.note}</span> : null}
          <span className="block m-text-meta m-ink-3">{e.user_label ?? "system"}{e.created_at ? `, ${formatDate(e.created_at, "datetime")}` : ""}, check <Mono inline>{e.check_id}</Mono></span>
        </li>
      ))}
    </ol>
  );
}

const ISSUE_STATUS: Record<string, string> = { open: "open", in_progress: "fix proposed", accepted: "signed off", resolved: "fixed" };
const STATUS_LABEL = (s: string) => ISSUE_STATUS[s] ?? s.replace(/_/g, " ");

/**
 * One failing record, everything a cleaner needs on one sheet: each check it fails in plain words, the field,
 * the value now, the suggested value and where it comes from, and the decision buttons. Accept and edit put the
 * value in the user's draft fix batch; a second person approves it before it goes to SAP.
 */
export function RecordPanel({ module, recordKey, run, onDecided, footer, fullRecordLink = true }: {
  module: string; recordKey: string; run: string | undefined; onDecided?: () => void; footer?: ReactNode;
  /** Off on the full record page itself. */
  fullRecordLink?: boolean;
}) {
  const q = useQuery({ queryKey: workRecordKey(module, recordKey, run), queryFn: () => getWorkRecord(module, recordKey, run) });
  const [editing, setEditing] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const m = useDecide(module, recordKey, run, onDecided);
  const c = useDecide(module, recordKey, run);
  // People the record can be handed to (needs `assign`, as the decision does).
  const people = useQuery({ queryKey: ["users", "assignable"], queryFn: getAssignableUsers, enabled: !!q.data?.can.assign, staleTime: 300_000, meta: { ignoreError: true } });
  if (q.isLoading) return <Card><Skeleton height={320} /></Card>;
  if (q.isError || !q.data) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  const rec = q.data;
  const open = rec.issues.filter((i) => i.status === "to_fix");
  const acceptable = open.filter((i) => i.suggestion);
  const base = { module, record_key: recordKey };
  return (
    <Card
      title={<span className="flex flex-col"><span>{rec.name ?? <Mono inline>{rec.record_key}</Mono>}</span>{rec.name ? <span className="m-text-meta m-ink-3"><Mono inline>{rec.record_key}</Mono></span> : null}</span>}
      meta={<span className="flex flex-wrap items-center gap-2">{formatModuleName(module)}, {rec.issues.length} failing {rec.issues.length === 1 ? "check" : "checks"} <Pill tone={STATUS[rec.status].tone}>{STATUS[rec.status].label}</Pill></span>}
      actions={fullRecordLink && <Button variant="ghost" render={<Link href={`/objects/${module}/records/${encodeURIComponent(recordKey)}${run ? `?run=${run}` : ""}`}>Full record</Link>} />}
    >
      <div className="flex flex-col gap-4" data-testid="record-panel">
        {!rec.can.fix ? <Notice tone="info">Your role can view this record. Fixing it needs the apply permission.</Notice> : null}
        <RecordContext rec={rec} />
        {rec.can.fix && acceptable.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--m-radius-control)] bg-[var(--m-sheet-raised)] p-3">
            <span className="m-text-body m-ink-2 flex-1">{acceptable.length} suggested values for this record.</span>
            <Button pending={m.isPending} onClick={() => m.mutate(acceptable.map((i) => ({ ...base, check_id: i.check_id, action: "accept" as const })))}>Accept all {acceptable.length}</Button>
          </div>
        ) : null}
        {rec.issues.map((i) => (
          <IssueCard key={i.check_id} issue={i} rec={rec} run={run} onDecided={onDecided}
            editing={editing === i.check_id} setEditing={(on) => setEditing(on ? i.check_id : null)} />
        ))}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--m-line)] pt-3">
          <span className="m-text-body m-ink-2 flex-1">{rec.assignee_email ? <>Assigned to {rec.assignee_email}</> : "Not assigned"}</span>
          {rec.can.assign ? (
            rec.assigned_to ? <Button variant="ghost" pending={c.isPending} onClick={() => c.mutate([{ ...base, action: "assign", assignee: "" }])}>Release</Button>
              : <Button variant="secondary" pending={c.isPending} onClick={() => c.mutate([{ ...base, action: "assign", assignee: "me" }])}>Take it</Button>
          ) : null}
          {rec.can.assign && assignees(people.data, rec.assigned_to).length > 0 ? (
            <Select label="Assign to" value="" placeholder="Assign to…" options={assignees(people.data, rec.assigned_to)}
              onValueChange={(v) => { if (v) c.mutate([{ ...base, action: "assign", assignee: v }]); }} />
          ) : null}
        </div>

        {rec.can.comment ? (
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) c.mutate([{ ...base, action: "comment", note: comment }], { onSuccess: () => setComment("") }); }}>
            <Textarea aria-label="Comment" placeholder="Add a note for the team" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
            <div><Button type="submit" variant="secondary" pending={c.isPending} disabled={!comment.trim()}>Add comment</Button></div>
          </form>
        ) : null}

        <details>
          <summary className="cursor-pointer m-text-body m-ink-accent">History</summary>
          <div className="mt-2"><History rec={rec} /></div>
        </details>
        {/* On the full record page the field sheet below lists every field, these included. */}
        {fullRecordLink && Object.keys(rec.values).length ? (
          <details>
            <summary className="cursor-pointer m-text-body m-ink-accent">Fields the checks read</summary>
            <dl className="mt-2 grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-3 gap-y-1 m-text-body">
              {Object.entries(rec.values).map(([k, v]) => (<Fragment key={k}><dt><Mono inline>{k}</Mono></dt><dd><Value v={v} /></dd></Fragment>))}
            </dl>
          </details>
        ) : null}
        {footer}
      </div>
    </Card>
  );
}
