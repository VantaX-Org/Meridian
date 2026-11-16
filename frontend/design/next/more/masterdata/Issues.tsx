"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { bulkIssues, commentIssue, exportIssues, getIssue, getIssues, ISSUE_PAGE, ISSUE_STATUSES, RESOLUTIONS, type Issue, type IssueEvent, type IssueResolution, type IssueStatus } from "@/lib/api/v2/issues";
import { getAssignable } from "@/lib/api/v2/triage";
import { formatDate } from "@/lib/format";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int, moduleFromSlug } from "@/lib/v2/score";
import { recordItemId } from "@/lib/v2/work";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, SegmentedControl, SidePanel, Skeleton, StatCard, useToast, type Column } from "../../kit";
import { ChartCard, compact } from "../ChartCard";
import { TableSave } from "./TableSave";
import { httpStatus, noRetry4xx, sevTone, sevWord } from "./util";

/**
 * Record issues, native: the steward work list. One row per record and rule that failed, carried from run to run with
 * its status, owner, due date and history. Stewards filter it, assign and move issues in bulk, and open one to see
 * who did what and in which runs it failed. Nothing in SAP changes.
 */

const STATUS_TEXT: Record<IssueStatus, () => string> = {
  open: () => t("Open"),
  in_progress: () => t("In progress"),
  waiting_sap: () => t("Waiting on SAP"),
  waiting_requester: () => t("Waiting on the requester"),
  accepted: () => t("Accepted"),
  resolved: () => t("Resolved"),
};
const RESOLUTION_TEXT: Record<IssueResolution, () => string> = {
  accepted_risk: () => t("Risk accepted"),
  false_positive: () => t("False positive"),
  fixed_in_source: () => t("Fixed in the source"),
};
const SLA_TEXT: Record<string, () => string> = {
  breached: () => t("Overdue"),
  at_risk: () => t("Due soon"),
  on_track: () => t("On time"),
  paused: () => t("Clock paused"),
};
const statusText = (s: string) => STATUS_TEXT[s as IssueStatus]?.() ?? s;

export function RecordIssues() {
  const fixture = useFixture();
  const session = useV2Session();
  const toast = useToast();
  const { hrefFor } = useOpenItem();
  const [view, setView] = useUrlParam<IssueStatus | "all">("status", "open", [...ISSUE_STATUSES, "all"]);
  const tab: IssueStatus | "" = view === "all" ? "" : view;
  const [urlSearch] = useUrlParam<string>("search", "");
  const [draft, setDraft] = useState({ severity: "", assigned_to: "", search: urlSearch });
  const [filter, setFilter] = useState(draft);
  const [offset, setOffset] = useState(0);
  const [round, setRound] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [modSlug, setModSlug] = useUrlParam<string>("module", "");
  const [rule, setRule] = useUrlParam<string>("rule", "");
  const scope = { module: modSlug ? moduleFromSlug(modSlug) : "", check_id: rule };
  const q = { status: tab, ...filter, ...scope, search: filter.search.trim(), limit: ISSUE_PAGE, offset };
  const list = useQuery({ queryKey: ["record-issues", fixture, q], queryFn: () => getIssues(q), staleTime: 30_000, placeholderData: keepPreviousData, retry: noRetry4xx });
  const exp = useMutation({
    mutationFn: () => exportIssues({ status: tab, ...filter, ...scope, search: filter.search.trim() }),
    onError: (e) => toast({ text: errorSentence(e, t("The issues could not be exported.")), tone: "bad" }),
  });
  const page = (o: number) => { setOffset(o); setRound(round + 1); };
  const submit = (e: FormEvent) => { e.preventDefault(); setFilter(draft); page(0); };

  if (list.isPending) return <div className="nx-body"><Skeleton lines={8} label={t("Issues")} /></div>;
  if (list.isError) {
    return (
      <div className="nx-body" data-testid="issues-page">
        {httpStatus(list.error) === 403 ? <EmptyState heading={t("Your role cannot read the record issues.")} /> : (
          <ErrorState sentence={t("The record issues could not be read.")} error={list.error} onRetry={() => void list.refetch()} />
        )}
      </div>
    );
  }
  const { counts, items, total } = list.data;
  const n = (s: IssueStatus) => counts[s] ?? 0;
  const active = n("open") + n("in_progress") + n("waiting_sap") + n("waiting_requester");
  const all = ISSUE_STATUSES.reduce((sum, s) => sum + n(s), 0);
  const mayChange = session.can("assign") || session.can("approve") || session.can("analyse");

  const cols: Column<Issue>[] = [
    {
      id: "record", label: t("Record"), compare: (a, b) => a.record_key.localeCompare(b.record_key),
      cell: (i) => <button type="button" className="nx-linkbtn" onClick={() => setOpen(i.id)} aria-label={t("Select {key}", { key: i.record_key })}><Code code={i.record_key} text={moduleText(i.module)} /></button>,
    },
    {
      id: "rule", label: t("Rule"), cell: (i) => (
        <span className="nx-cell-stack">
          <V2Link href={hrefFor({ kind: "rule", id: i.check_id })} data-testid="issues-rule"><Code code={i.check_id} text={i.message ?? t("The run stored no message for this rule.")} /></V2Link>
          {i.field ? <span className="nx-sub"><Code code={sapField(i.field)} text={describeField(i.field) ?? undefined} /></span> : null}
        </span>
      ),
    },
    { id: "sev", label: t("Severity"), cell: (i) => <Chip tone={sevTone(i.severity)}>{sevWord(i.severity)}</Chip> },
    {
      id: "status", label: t("Status"), compare: (a, b) => a.status.localeCompare(b.status),
      cell: (i) => <span className="nx-cell-stack">{statusText(i.status)}{i.resolution ? <span className="nx-sub">{RESOLUTION_TEXT[i.resolution]?.() ?? i.resolution}</span> : null}</span>,
    },
    { id: "who", label: t("Assigned to"), cell: (i) => i.assignee_email ?? t("No one is assigned") },
    {
      id: "due", label: t("Due"), align: "end", compare: (a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""),
      cell: (i) => <span className="nx-cell-stack">{i.due_at ? formatDate(i.due_at, "date") : t("No due date")}{i.sla_state ? <span className="nx-sub">{SLA_TEXT[i.sla_state]?.() ?? i.sla_state}</span> : null}</span>,
    },
    { id: "reopened", label: t("Reopened"), align: "end", compare: (a, b) => a.reopened_count - b.reopened_count, cell: (i) => int(i.reopened_count) },
  ];

  return (
    <div className="nx-body" data-testid="issues-page">
      <section aria-label={t("Record issues")} data-testid="issues-banner">
        <h2>{t("{n} issues still to close", { n: int(active) })}</h2>
        {n("open") ? <p className="nx-sub">{t("{n} have no one working on them yet.", { n: int(n("open")) })}</p> : null}
        <p className="nx-sub">{t("Changing a status or assigning an issue records it here. Nothing in SAP is changed.")}</p>
        <div className="nx-statgrid">
          <StatCard label={t("In progress")} value={n("in_progress")} />
          <StatCard label={t("Waiting on SAP")} value={n("waiting_sap")} />
          <StatCard label={t("Waiting on the requester")} value={n("waiting_requester")} />
          <StatCard label={t("Closed")} value={n("accepted") + n("resolved")} />
        </div>
      </section>
      <div className="nx-chartcards">
        <ChartCard
          title={t("Where the issues stand")} state={all ? "ready" : "empty"} testId="issues-status"
          chart={<PartBar segments={ISSUE_STATUSES.map((s) => ({ label: STATUS_TEXT[s](), value: n(s) }))} label={t("Where the issues stand")} format={compact} />}
          figure={int(all)} line={t("All {n}", { n: int(all) })} emptyLine={t("No issues match. Change the status or the filter.")}
        />
      </div>
      <SegmentedControl
        label={t("Show issues by status")} value={view}
        items={[{ value: "all" as const, label: `${t("All")} ${int(all)}` }, ...ISSUE_STATUSES.map((s) => ({ value: s, label: `${STATUS_TEXT[s]()} ${int(n(s))}` }))]}
        onChange={(v) => { setView(v); page(0); }}
      />
      {scope.module || rule ? (
        <p className="nx-row nx-wrap" data-testid="issues-scope">
          {scope.module ? <span>{t("Only {object}", { object: moduleText(scope.module) })} <Button size={32} variant="quiet" onClick={() => { setModSlug(""); page(0); }}>{t("Show every object")}</Button></span> : null}
          {rule ? <span>{t("Only rule {rule}", { rule })} <Button size={32} variant="quiet" onClick={() => { setRule(""); page(0); }}>{t("Show every rule")}</Button></span> : null}
        </p>
      ) : null}
      <form className="nx-row nx-wrap" onSubmit={submit} aria-label={t("Filter the issues")} data-testid="issues-filter">
        <label className="nx-field">
          {t("Severity")}
          <select className="nx-input" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
            <option value="">{t("Any severity")}</option>
            {["critical", "high", "medium", "low"].map((s) => <option key={s} value={s}>{sevWord(s)}</option>)}
          </select>
        </label>
        <label className="nx-field">
          {t("Assigned to")}
          <select className="nx-input" value={draft.assigned_to} onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value })}>
            <option value="">{t("Anyone")}</option>
            <option value="me">{t("Me")}</option>
            <option value="unassigned">{t("No one")}</option>
          </select>
        </label>
        <label className="nx-field">
          {t("Record key")}
          <input className="nx-input" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder={t("Any record")} />
        </label>
        <Button type="submit" variant="secondary">{t("Show issues")}</Button>
        {session.can("export") ? (
          <Button type="button" variant="quiet" icon="download" disabled={exp.isPending || total === 0} onClick={() => exp.mutate()} data-testid="issues-export">{t("Export to Excel")}</Button>
        ) : null}
      </form>
      <div data-testid="issues-table">
        <p className="nx-sub">{items.length ? t("{from} to {to} of {n}, most severe first", { from: int(offset + 1), to: int(offset + items.length), n: int(total) }) : null}</p>
        <TableSave title={t("Issues")}>
          <DataTable
            key={round} rows={items} columns={cols} rowKey={(i) => i.id} rowLabel={(i) => i.record_key} caption={t("Issues")} total={total}
            selectable={mayChange} bulkActions={(ids) => <BulkForm ids={ids} onDone={() => setRound(round + 1)} />}
            onOpenRow={(i) => setOpen(i.id)}
            empty={{ heading: t("No issues match. Change the status or the filter.") }}
          />
        </TableSave>
        {total > ISSUE_PAGE ? (
          <div className="nx-row">
            <Button size={32} variant="secondary" disabled={offset === 0} onClick={() => page(Math.max(0, offset - ISSUE_PAGE))}>{t("Previous")}</Button>
            <Button size={32} variant="secondary" disabled={offset + ISSUE_PAGE >= total} onClick={() => page(offset + ISSUE_PAGE)}>{t("Next")}</Button>
          </div>
        ) : null}
      </div>
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={t("Issue")}>
        {open ? <IssueDetail id={open} /> : null}
      </SidePanel>
    </div>
  );
}

function BulkForm({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const session = useV2Session();
  const can = (p: string) => session.can(p) && !session.shared && !session.viewAs;
  const toast = useToast();
  const qc = useQueryClient();
  const fixture = useFixture();
  const [to, setTo] = useState<IssueStatus | "">("");
  const [resolution, setResolution] = useState<IssueResolution | "">("");
  const [who, setWho] = useState("-");
  const [note, setNote] = useState("");
  const people = useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, enabled: can("assign"), retry: noRetry4xx });
  const choices = to ? RESOLUTIONS[to] : undefined;
  const send = useMutation({
    mutationFn: () => bulkIssues({
      ids,
      ...(to ? { status: to } : {}),
      ...(to && resolution ? { resolution } : {}),
      ...(who !== "-" ? { assigned_to: who } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: (r) => {
      toast({ text: t("{n} issues updated.", { n: int(r.updated) }), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["record-issues"] });
      void qc.invalidateQueries({ queryKey: ["record-issue"] });
      onDone();
    },
    onError: (e) => toast({ text: errorSentence(e, t("The issues could not be updated.")), tone: "bad" }),
  });
  const mayMove = (s: IssueStatus) => (s === "accepted" ? can("approve") : can("assign"));
  const missing = (choices && !resolution) || (resolution === "false_positive" && !note.trim());
  const nothing = !to && who === "-" && !note.trim();
  if (!can("assign") && !can("approve") && !can("analyse")) return null;
  return (
    <form className="nx-row nx-wrap" aria-label={t("Change the selected issues")} data-testid="issues-bulk" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <label className="nx-field">
        {t("Move to")}
        <select className="nx-input" value={to} onChange={(e) => { setTo(e.target.value as IssueStatus | ""); setResolution(""); }}>
          <option value="">{t("Keep the status")}</option>
          {ISSUE_STATUSES.filter(mayMove).map((s) => <option key={s} value={s}>{STATUS_TEXT[s]()}</option>)}
        </select>
      </label>
      {choices ? (
        <label className="nx-field">
          {t("Resolution")}
          <select className="nx-input" value={resolution} onChange={(e) => setResolution(e.target.value as IssueResolution | "")} required>
            <option value="">{t("Choose")}</option>
            {choices.map((r) => <option key={r} value={r}>{RESOLUTION_TEXT[r]()}</option>)}
          </select>
        </label>
      ) : null}
      {can("assign") ? (
        <label className="nx-field">
          {t("Assign to")}
          <select className="nx-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="-">{t("Keep the assignee")}</option>
            <option value="">{t("No one")}</option>
            {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className="nx-field">
        {resolution === "false_positive" ? t("Why it is a false positive") : t("Note")}
        <input className="nx-input" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} required={resolution === "false_positive"} />
      </label>
      <Button type="submit" variant="primary" size={32} loading={send.isPending} disabled={nothing || !!missing} data-testid="issues-apply">{t("Apply")}</Button>
    </form>
  );
}

function IssueDetail({ id }: { id: string }) {
  const fixture = useFixture();
  const session = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const { hrefFor } = useOpenItem();
  const [body, setBody] = useState("");
  const people = useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, enabled: session.can("assign"), retry: noRetry4xx });
  const names = new Map((people.data ?? []).map((u) => [u.id, u.name]));
  const one = useQuery({ queryKey: ["record-issue", fixture, id], queryFn: () => getIssue(id), staleTime: 30_000, retry: noRetry4xx });
  const add = useMutation({
    mutationFn: () => commentIssue(id, body.trim()),
    onSuccess: () => { setBody(""); void qc.invalidateQueries({ queryKey: ["record-issue", fixture, id] }); },
    onError: (e) => toast({ text: errorSentence(e, t("The comment could not be saved.")), tone: "bad" }),
  });
  if (one.isPending) return <Skeleton lines={4} label={t("Issue")} />;
  if (one.isError) {
    return httpStatus(one.error) === 404 ? <EmptyState heading={t("This issue no longer exists.")} /> : (
      <ErrorState sentence={t("The issue could not be read.")} error={one.error} onRetry={() => void one.refetch()} />
    );
  }
  const { issue, runs, events } = one.data;
  return (
    <div className="nx-body" data-testid="issues-detail">
      <h3>{t("{key} against {rule}", { key: issue.record_key, rule: issue.check_id })}</h3>
      <p className="nx-sub">{statusText(issue.status)}</p>
      <p className="nx-row nx-wrap">
        <V2Link href={hrefFor({ kind: "record", id: recordItemId(issue) })} className="nx-btn nx-btn-secondary nx-btn-sm" data-testid="issues-open-record">{t("Open the record")}</V2Link>
        <V2Link href={hrefFor({ kind: "rule", id: issue.check_id })} className="nx-btn nx-btn-secondary nx-btn-sm">{t("Open the rule")}</V2Link>
      </p>
      <p className="nx-sub">
        {t("First failed {first}, last failed {last}", {
          first: issue.first_seen_at ? formatDate(issue.first_seen_at, "date") : "-",
          last: issue.last_seen_at ? formatDate(issue.last_seen_at, "date") : "-",
        })}
      </p>
      <h4>{t("Runs")}</h4>
      {runs.length === 0 ? <p className="nx-sub">{t("No run has checked this record since it was first found.")}</p> : (
        <ol aria-label={t("Runs, newest first")} data-testid="issues-runs">
          {runs.map((r) => (
            <li key={r.version_id}>
              {r.run_at ? formatDate(r.run_at, "date") : <span className="nx-mono">{r.version_id}</span>}{" "}
              <Chip tone={r.failing ? "bad" : "good"}>{r.failing ? t("Failing") : t("Clean")}</Chip>
            </li>
          ))}
        </ol>
      )}
      <h4>{t("History")}</h4>
      {events.length === 0 ? <p className="nx-sub">{t("Nothing has been done on this issue yet.")}</p> : (
        <ol aria-label={t("History, newest first")} data-testid="issues-events">
          {events.map((ev, k) => <li key={k}>{eventText(ev, names)} <span className="nx-sub">{ev.user_label ?? "-"}, {formatDate(ev.created_at, "date")}</span></li>)}
        </ol>
      )}
      {session.can("analyse") && !session.shared && !session.viewAs ? (
        <form className="nx-row nx-wrap" aria-label={t("Add a comment")} onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <label className="nx-field">
            {t("Comment")}
            <input className="nx-input" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary" size={32} loading={add.isPending} disabled={!body.trim()}>{t("Add comment")}</Button>
        </form>
      ) : null}
    </div>
  );
}

function eventText(ev: IssueEvent, names: Map<string, string>): string {
  if (ev.action === "assign") return ev.to_value ? t("Assigned to {who}", { who: names.get(ev.to_value) ?? ev.to_value }) : t("Unassigned");
  if (ev.action === "status") {
    const text = t("Moved from {from} to {to}", { from: statusText(ev.from_value ?? ""), to: statusText(ev.to_value ?? "") });
    return ev.note ? `${text}: ${ev.note}` : text;
  }
  return ev.note ?? "";
}
