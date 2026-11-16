"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  bulkIssues, commentIssue, exportIssues, getIssue, getIssues, ISSUE_PAGE, ISSUE_STATUSES, RESOLUTIONS,
  type Issue, type IssueEvent, type IssueResolution, type IssueStatus,
} from "@/lib/api/v2/issues";
import { getAssignable } from "@/lib/api/v2/triage";
import { formatDate } from "@/lib/format";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int, moduleFromSlug } from "@/lib/v2/score";
import { recordItemId } from "@/lib/v2/work";
import { NxLink } from "../kit/Link";
import { Button, Code, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton, useToast, type Column } from "../kit";
import { SevChip } from "../object/tabs/tabs-g-parts";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";
import { ExportTable } from "./ExportTable";

/**
 * Record issues, native: the steward work list (api/routes/record_issues.py). Same reads, filters, bulk changes,
 * export and per-issue history as the v2 screen; kit table selection drives the bulk bar.
 */

const httpStatus = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = httpStatus(e); return s !== 403 && s !== 404 && n < 2; };

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

export function Issues() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const toast = useToast();
  const { hrefFor } = useOpenItem();
  const [view, setView] = useUrlParam<IssueStatus | "all">("status", "open", [...ISSUE_STATUSES, "all"]);
  const tab: IssueStatus | "" = view === "all" ? "" : view;
  const [urlSearch] = useUrlParam<string>("search", "");
  const [draft, setDraft] = useState({ severity: "", assigned_to: "", search: urlSearch });
  const [filter, setFilter] = useState(draft);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [modSlug, setModSlug] = useUrlParam<string>("module", "");
  const [rule, setRule] = useUrlParam<string>("rule", "");
  const scope = { module: modSlug ? moduleFromSlug(modSlug) : "", check_id: rule };
  const q = { status: tab, ...filter, ...scope, search: filter.search.trim(), limit: ISSUE_PAGE, offset };
  const list = useQuery({
    queryKey: ["record-issues", fixture, q],
    queryFn: () => getIssues(q),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry,
  });
  const exp = useMutation({
    mutationFn: () => exportIssues({ status: tab, ...filter, ...scope, search: filter.search.trim() }),
    onError: (e) => toast({ text: errorSentence(e, t("The issues could not be exported.")), tone: "bad" }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilter(draft);
    setOffset(0);
  };

  if (list.isPending) return <Skeleton lines={6} label={t("Issues")} />;
  if (list.isError) {
    return httpStatus(list.error) === 403
      ? <EmptyState heading={t("Your role cannot read the record issues.")} />
      : <ErrorState sentence={t("The record issues could not be read.")} onRetry={() => void list.refetch()} />;
  }

  const { counts, items, total } = list.data;
  const n = (s: IssueStatus) => counts[s] ?? 0;
  const active = n("open") + n("in_progress") + n("waiting_sap") + n("waiting_requester");
  const all = ISSUE_STATUSES.reduce((sum, s) => sum + n(s), 0);

  const columns: Column<Issue>[] = [
    {
      id: "record", label: t("Record"),
      cell: (i) => <span className="nx-cell-stack"><span>{moduleText(i.module)}</span><Code code={i.record_key} /></span>,
    },
    {
      id: "rule", label: t("Rule"),
      cell: (i) => {
        const fieldText = i.field ? describeField(i.field) : null;
        return (
          <span className="nx-cell-stack">
            <NxLink href={hrefFor({ kind: "rule", id: i.check_id })} className="nx-link nx-mono" data-testid="issues-rule">{i.check_id}</NxLink>
            <span>{i.message ?? <span title={t("The run stored no message for this rule.")}>-</span>}</span>
            {i.field ? <Code code={sapField(i.field)} text={fieldText ?? undefined} /> : null}
          </span>
        );
      },
    },
    { id: "severity", label: t("Severity"), cell: (i) => <SevChip severity={i.severity} /> },
    {
      id: "status", label: t("Status"),
      cell: (i) => (
        <span className="nx-cell-stack">
          <span>{statusText(i.status)}</span>
          {i.resolution ? <span className="nx-sub">{RESOLUTION_TEXT[i.resolution]?.() ?? i.resolution}</span> : null}
        </span>
      ),
    },
    { id: "assignee", label: t("Assigned to"), cell: (i) => i.assignee_email ?? <span className="nx-sub">{t("No one is assigned")}</span> },
    {
      id: "due", label: t("Due"),
      cell: (i) => (
        <span className="nx-cell-stack">
          <span>{i.due_at ? formatDate(i.due_at, "date") : <span className="nx-sub">{t("No due date")}</span>}</span>
          {i.sla_state ? <span className="nx-sub">{SLA_TEXT[i.sla_state]?.() ?? i.sla_state}</span> : null}
        </span>
      ),
    },
    { id: "reopened", label: t("Reopened"), align: "end", cell: (i) => int(i.reopened_count), compare: (a, b) => a.reopened_count - b.reopened_count },
  ];

  const tabs = [{ value: "all", label: `${t("All")} ${int(all)}` }, ...ISSUE_STATUSES.map((s) => ({ value: s, label: `${STATUS_TEXT[s]()} ${int(n(s))}` }))];

  return (
    <div className="nx-body">
      <About
        shows={t("Lists the failing records people are working on, with who owns each and where it stands.")}
        next={{ href: "/work", label: t("Open the work queue") }}
        why={t("Changing a status or assigning an issue records it here. Nothing in SAP is changed.")}
        means={[
          [t("In progress"), t("Issues someone is working on now.")],
          [t("Waiting on SAP"), t("Issues waiting for a change in SAP.")],
          [t("Closed"), t("Issues accepted or resolved.")],
        ]}
      />
      <Banner
        title={t("{n} issues still to close", { n: int(active) })}
        why={n("open") ? t("{n} have no one working on them yet.", { n: int(n("open")) }) : null}
        meta={t("Record issues")}
        label={t("Record issues")}
        testId="issues-banner"
        figs={[
          { label: t("In progress"), value: int(n("in_progress")) },
          { label: t("Waiting on SAP"), value: int(n("waiting_sap")), note: t("{n} on the requester", { n: int(n("waiting_requester")) }) },
          { label: t("Closed"), value: int(n("accepted") + n("resolved")), note: t("{a} accepted, {r} resolved", { a: int(n("accepted")), r: int(n("resolved")) }) },
        ]}
      />
      <Fold title={t("Where the issues stand")} hint={t("The issues counted by status.")}>
        <Panel title={t("Where the issues stand")} meta={t("All {n}", { n: int(all) })} testId="issues-status">
          <HBars
            label={t("Where the issues stand")}
            rows={ISSUE_STATUSES.map((s) => ({
              key: s, label: STATUS_TEXT[s](), value: all ? (n(s) / all) * 100 : 0, text: int(n(s)),
              tone: s === "accepted" || s === "resolved" ? "good" : s === "open" ? "bad" : "warn",
            }))}
          />
        </Panel>
      </Fold>
      <div data-testid="issues-tabs">
        <SegmentedControl label={t("Show issues by status")} value={view} items={tabs} onChange={(v) => { setView(v as IssueStatus | "all"); setOffset(0); }} />
      </div>
      {scope.module || rule ? (
        <p className="nx-row nx-wrap" data-testid="issues-scope">
          {scope.module ? (
            <span>{t("Only {object}", { object: moduleText(scope.module) })} <Button variant="quiet" size={32} onClick={() => { setModSlug(""); setOffset(0); }}>{t("Show every object")}</Button></span>
          ) : null}
          {rule ? (
            <span>{t("Only rule {rule}", { rule })} <Button variant="quiet" size={32} onClick={() => { setRule(""); setOffset(0); }}>{t("Show every rule")}</Button></span>
          ) : null}
        </p>
      ) : null}
      <form className="nx-row nx-wrap" onSubmit={submit} aria-label={t("Filter the issues")} data-testid="issues-filter">
        <label className="nx-field">
          {t("Severity")}
          <select className="nx-input" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
            <option value="">{t("Any severity")}</option>
            <option value="critical">{t("Critical")}</option>
            <option value="high">{t("High")}</option>
            <option value="medium">{t("Medium")}</option>
            <option value="low">{t("Low")}</option>
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
        <Button type="submit" variant="secondary" size={32}>{t("Show issues")}</Button>
        {can("export") ? (
          <Button variant="quiet" size={32} disabled={exp.isPending || total === 0} loading={exp.isPending} onClick={() => exp.mutate()} data-testid="issues-export">
            {t("Export to Excel")}
          </Button>
        ) : null}
      </form>
      {items.length === 0 ? (
        <EmptyState heading={t("No issues match. Change the status or the filter.")} />
      ) : (
        <Panel
          title={t("Issues")}
          meta={t("{from} to {to} of {n}, most severe first", { from: int(offset + 1), to: int(offset + items.length), n: int(total) })}
          testId="issues-table"
        >
          <ExportTable>
            <DataTable
              key={`${view}-${offset}-${JSON.stringify(filter)}`}
              rows={items}
              columns={columns}
              rowKey={(i) => i.id}
              rowLabel={(i) => t("Select {key}", { key: i.record_key })}
              caption={t("Issues")}
              total={total}
              selectable={can("assign") || can("approve") || can("analyse")}
              bulkActions={(keys) => <BulkBar ids={keys} />}
              onOpenRow={(i) => setOpen(open === i.id ? null : i.id)}
            />
          </ExportTable>
          {total > ISSUE_PAGE ? (
            <div className="nx-row">
              <Button variant="secondary" size={32} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - ISSUE_PAGE))}>{t("Previous")}</Button>
              <Button variant="secondary" size={32} disabled={offset + ISSUE_PAGE >= total} onClick={() => setOffset(offset + ISSUE_PAGE)}>{t("Next")}</Button>
            </div>
          ) : null}
        </Panel>
      )}
      {open ? <IssueDetail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function BulkBar({ ids }: { ids: string[] }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const fixture = useFixture();
  const [to, setTo] = useState<IssueStatus | "">("");
  const [resolution, setResolution] = useState<IssueResolution | "">("");
  const [who, setWho] = useState<string>("-");
  const [note, setNote] = useState("");
  const people = useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, enabled: can("assign"), retry });
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
    },
    onError: (e) => toast({ text: errorSentence(e, t("The issues could not be updated.")), tone: "bad" }),
  });
  const mayMove = (s: IssueStatus) => (s === "accepted" ? can("approve") : can("assign"));
  const missing = (choices && !resolution) || (resolution === "false_positive" && !note.trim());
  const nothing = !to && who === "-" && !note.trim();
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
      <Button type="submit" variant="primary" size={32} loading={send.isPending} disabled={nothing || !!missing || send.isPending}>{t("Apply")}</Button>
    </form>
  );
}

function IssueDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const fixture = useFixture();
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const { hrefFor } = useOpenItem();
  const [body, setBody] = useState("");
  const people = useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, enabled: can("assign"), retry });
  const names = new Map((people.data ?? []).map((u) => [u.id, u.name]));
  const one = useQuery({ queryKey: ["record-issue", fixture, id], queryFn: () => getIssue(id), staleTime: 30_000, retry });
  const add = useMutation({
    mutationFn: () => commentIssue(id, body.trim()),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["record-issue", fixture, id] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The comment could not be saved.")), tone: "bad" }),
  });
  const title = one.data ? t("{key} against {rule}", { key: one.data.issue.record_key, rule: one.data.issue.check_id }) : t("Issue");
  return (
    <Panel title={title} meta={one.data ? statusText(one.data.issue.status) : undefined} testId="issues-detail">
      {one.isPending ? (
        <Skeleton lines={3} label={t("Issue")} />
      ) : one.isError ? (
        httpStatus(one.error) === 404
          ? <EmptyState heading={t("This issue no longer exists.")} />
          : <ErrorState sentence={t("The issue could not be read.")} onRetry={() => void one.refetch()} />
      ) : (
        <>
          <p className="nx-row nx-wrap">
            <NxLink href={hrefFor({ kind: "record", id: recordItemId(one.data.issue) })} className="nx-link" data-testid="issues-open-record">{t("Open the record")}</NxLink>
            <NxLink href={hrefFor({ kind: "rule", id: one.data.issue.check_id })} className="nx-link">{t("Open the rule")}</NxLink>
          </p>
          <p className="nx-sub">
            {t("First failed {first}, last failed {last}", {
              first: one.data.issue.first_seen_at ? formatDate(one.data.issue.first_seen_at, "date") : "—",
              last: one.data.issue.last_seen_at ? formatDate(one.data.issue.last_seen_at, "date") : "—",
            })}
          </p>
          <h3>{t("Runs")}</h3>
          {one.data.runs.length === 0 ? (
            <p className="nx-sub">{t("No run has checked this record since it was first found.")}</p>
          ) : (
            <ol aria-label={t("Runs, newest first")} data-testid="issues-runs">
              {one.data.runs.map((r) => (
                <li key={r.version_id}>
                  {r.run_at ? formatDate(r.run_at, "date") : <Code code={r.version_id} />}{" "}
                  <span className="nx-sub">{r.failing ? t("Failing") : t("Clean")}</span>
                </li>
              ))}
            </ol>
          )}
          <h3>{t("History")}</h3>
          {one.data.events.length === 0 ? (
            <p className="nx-sub">{t("Nothing has been done on this issue yet.")}</p>
          ) : (
            <ol aria-label={t("History, newest first")} data-testid="issues-events">
              {one.data.events.map((ev, k) => <li key={k}>{eventText(ev, names)} <span className="nx-sub">{ev.user_label ?? "—"}, {formatDate(ev.created_at, "date")}</span></li>)}
            </ol>
          )}
          {can("analyse") ? (
            <form className="nx-row nx-wrap" aria-label={t("Add a comment")} onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <label className="nx-field">
                {t("Comment")}
                <input className="nx-input" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
              </label>
              <Button type="submit" variant="secondary" size={32} loading={add.isPending} disabled={!body.trim() || add.isPending}>{t("Add comment")}</Button>
            </form>
          ) : null}
        </>
      )}
      <Button variant="quiet" size={32} onClick={onClose}>{t("Close")}</Button>
    </Panel>
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
