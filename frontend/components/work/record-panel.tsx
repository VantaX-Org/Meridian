"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, ErrorState, Input, Mono, Notice, Pill, SeverityDot, Skeleton, Textarea, isSeverity } from "@/design";
import { decide, getWorkRecord, type Decision, type WorkIssue, type WorkRecordDetail } from "@/lib/api/work";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName } from "@/lib/format";
import { SOURCE, STATUS, dueLabel } from "./status";

export const workRecordKey = (module: string, key: string, run?: string) => ["work", "record", module, key, run ?? "latest"];

/** A value as the record holds it: blank and missing are shown, never an empty cell. */
export function Value({ v }: { v: string | null | undefined }) {
  if (v === null || v === undefined) return <span className="m-ink-3 italic">missing</span>;
  if (v.trim() === "") return <span className="m-ink-3 italic">blank</span>;
  return <Mono inline>{v}</Mono>;
}

function useDecide(module: string, recordKey: string, run: string | undefined, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Decision[]) => decide(items, run),
    onSuccess: (r, items) => {
      const a = items[0]?.action;
      toast.success(a === "undo" ? "Decision undone" : a === "assign" ? "Assignment saved" : a === "comment" ? "Comment added"
        : a === "not_an_issue" || a === "accept_risk" ? "Signed off" : "Fix proposed: it waits in your draft batch for approval");
      void qc.invalidateQueries({ queryKey: ["work"] });
      if (r.updated > 0 && a !== "comment" && a !== "assign") onDone?.();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

type SignOff = "not_an_issue" | "accept_risk";

function IssueCard({ issue, rec, run, onDecided, editing, setEditing }: {
  issue: WorkIssue; rec: WorkRecordDetail; run: string | undefined; onDecided?: () => void;
  editing: boolean; setEditing: (on: boolean) => void;
}) {
  const [value, setValue] = useState(issue.suggestion?.value ?? "");
  const [signOff, setSignOff] = useState<SignOff | null>(null);
  const [reason, setReason] = useState("");
  const m = useDecide(rec.module, rec.record_key, run, onDecided);
  const base = { module: rec.module, record_key: rec.record_key, check_id: issue.check_id };
  const open = issue.status === "to_fix";
  const decided = issue.decision && issue.status !== "fixed" && issue.status !== "not_an_issue";
  const due = open ? dueLabel(issue.due_at) : null;
  const sev = isSeverity(issue.severity) ? issue.severity : "low";
  return (
    <section aria-label={issue.message} className="flex flex-col gap-3 border-b border-[var(--m-line)] pb-4 last:border-b-0 last:pb-0" data-testid="work-issue">
      <header className="flex flex-wrap items-start gap-2">
        <SeverityDot severity={sev} />
        <div className="min-w-0 flex-1">
          <p className="m-text-body font-medium m-ink">{issue.message}</p>
          <p className="m-text-meta m-ink-3">{issue.field ? <Mono inline>{issue.field}</Mono> : null} <Mono inline>{issue.check_id}</Mono></p>
        </div>
        <Pill tone={STATUS[issue.status].tone}>{STATUS[issue.status].label}</Pill>
        {due ? <Pill tone={due.tone}>{due.label}</Pill> : null}
      </header>

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
      {issue.why_it_matters || issue.sap_impact ? (
        <details className="m-text-body m-ink-2">
          <summary className="cursor-pointer m-ink-accent">Why it matters</summary>
          {issue.why_it_matters ? <p className="mt-1">{issue.why_it_matters}</p> : null}
          {issue.sap_impact ? <p className="mt-1">In SAP: {issue.sap_impact}</p> : null}
        </details>
      ) : null}

      {rec.can.fix && (open || issue.status === "proposed") ? (
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
export function RecordPanel({ module, recordKey, run, onDecided, footer }: {
  module: string; recordKey: string; run: string | undefined; onDecided?: () => void; footer?: ReactNode;
}) {
  const q = useQuery({ queryKey: workRecordKey(module, recordKey, run), queryFn: () => getWorkRecord(module, recordKey, run) });
  const [editing, setEditing] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const m = useDecide(module, recordKey, run, onDecided);
  const c = useDecide(module, recordKey, run);
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
      actions={<Button variant="ghost" render={<Link href={`/objects/${module}/records/${encodeURIComponent(recordKey)}${run ? `?run=${run}` : ""}`}>Full record</Link>} />}
    >
      <div className="flex flex-col gap-4" data-testid="record-panel">
        {!rec.can.fix ? <Notice tone="info">Your role can view this record. Fixing it needs the apply permission.</Notice> : null}
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
        {Object.keys(rec.values).length ? (
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
