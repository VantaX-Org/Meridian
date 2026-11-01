"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { bulkIssues, commentIssue, exportIssues, getIssue, getIssues, ISSUE_PAGE, ISSUE_STATUSES, RESOLUTIONS, type Issue, type IssueEvent, type IssueResolution, type IssueStatus } from "@/lib/api/v2/issues";
import { getAssignable } from "@/lib/api/v2/triage";
import { formatDate } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Record issues: the steward work list. One row per record and rule that failed, carried from run to run with its
 * status, owner, due date and history (api/routes/record_issues.py). Stewards filter it, assign and move issues in
 * bulk, and open one to see who did what and in which runs it failed.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

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
  const [view, setView] = useUrlParam<IssueStatus | "all">("status", "open", [...ISSUE_STATUSES, "all"]);
  const tab: IssueStatus | "" = view === "all" ? "" : view;
  const [draft, setDraft] = useState({ severity: "", assigned_to: "", search: "" });
  const [filter, setFilter] = useState(draft);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const q = { status: tab, ...filter, search: filter.search.trim(), limit: ISSUE_PAGE, offset };
  const list = useQuery({
    queryKey: ["record-issues", fixture, q],
    queryFn: () => getIssues(q),
    staleTime: 30_000,
    // Keep the last page on screen while a filter loads, so the form and the selection stay put.
    placeholderData: keepPreviousData,
    retry,
  });

  const exp = useMutation({
    mutationFn: () => exportIssues({ status: tab, ...filter }),
    onError: (e) => toast.show(errorSentence(e, t("The issues could not be exported.")), "error"),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilter(draft);
    setOffset(0);
    setPicked(new Set());
  };
  const pickTab = (s: IssueStatus | "") => {
    setView(s || "all");
    setOffset(0);
    setPicked(new Set());
  };

  if (list.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (list.isError) {
    return (
      <CcPage>
        {status(list.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the record issues.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void list.refetch()}>{t("The record issues could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const { counts, items, total } = list.data;
  const n = (s: IssueStatus) => counts[s] ?? 0;
  const active = n("open") + n("in_progress") + n("waiting_sap") + n("waiting_requester");
  const all = ISSUE_STATUSES.reduce((sum, s) => sum + n(s), 0);
  const shown = items.filter((i) => picked.has(i.id));
  const togglePage = () => setPicked(shown.length === items.length ? new Set() : new Set(items.map((i) => i.id)));

  return (
    <CcPage>
      <CcBanner
        eyebrow={t("Record issues")}
        headline={t("{n} issues still to close", { n: int(active) })}
        why={n("open") ? t("{n} have no one working on them yet.", { n: int(n("open")) }) : undefined}
        figs={[
          { label: t("In progress"), value: int(n("in_progress")) },
          { label: t("Waiting on SAP"), value: int(n("waiting_sap")), note: t("{n} on the requester", { n: int(n("waiting_requester")) }) },
          { label: t("Closed"), value: int(n("accepted") + n("resolved")), note: t("{a} accepted, {r} resolved", { a: int(n("accepted")), r: int(n("resolved")) }) },
        ]}
        testId="issues-banner"
        label={t("Record issues")}
      />
      <Panel title={t("Where the issues stand")} meta={t("All {n}", { n: int(all) })} testId="issues-status">
        <CcHBars
          label={t("Where the issues stand")}
          rows={ISSUE_STATUSES.map((s) => ({ key: s, label: STATUS_TEXT[s](), value: n(s), text: int(n(s)) }))}
        />
      </Panel>
      <div className="m2-rfilters" role="group" aria-label={t("Show issues by status")} data-testid="issues-tabs">
        {(["", ...ISSUE_STATUSES] as const).map((s) => (
          <button key={s || "all"} type="button" className="m2-btn" aria-pressed={tab === s} onClick={() => pickTab(s)}>
            {s ? STATUS_TEXT[s]() : t("All")} <span className="m2-meta">{int(s ? n(s) : all)}</span>
          </button>
        ))}
      </div>
      <form className="m2-rfilters" onSubmit={submit} aria-label={t("Filter the issues")} data-testid="issues-filter">
        <label>
          {t("Severity")}
          <select className="m2-sel" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
            <option value="">{t("Any severity")}</option>
            <option value="critical">{t("Critical")}</option>
            <option value="high">{t("High")}</option>
            <option value="medium">{t("Medium")}</option>
            <option value="low">{t("Low")}</option>
          </select>
        </label>
        <label>
          {t("Assigned to")}
          <select className="m2-sel" value={draft.assigned_to} onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value })}>
            <option value="">{t("Anyone")}</option>
            <option value="me">{t("Me")}</option>
            <option value="unassigned">{t("No one")}</option>
          </select>
        </label>
        <label>
          {t("Record key")}
          <input className="m2-inp" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} placeholder={t("Any record")} />
        </label>
        <button type="submit" className="m2-btn">{t("Show issues")}</button>
        {can("export") ? (
          <button type="button" className="m2-btn" disabled={exp.isPending || total === 0} onClick={() => exp.mutate()} data-testid="issues-export">
            {t("Export to Excel")}
          </button>
        ) : null}
      </form>
      {shown.length > 0 ? <BulkBar ids={shown.map((i) => i.id)} onDone={() => setPicked(new Set())} /> : null}
      {items.length === 0 ? (
        <EmptyFrame>{t("No issues match. Change the status or the filter.")}</EmptyFrame>
      ) : (
        <Panel
          title={t("Issues")}
          meta={t("{from} to {to} of {n}, most severe first", { from: int(offset + 1), to: int(offset + items.length), n: int(total) })}
          testId="issues-table"
        >
          <ScrollFrame label={t("Issues")}>
            <table className="m2-tbl m2-cards">
              <caption className="m2-sr">{t("Issues")}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <input type="checkbox" aria-label={t("Select every issue on this page")} checked={shown.length === items.length} onChange={togglePage} />
                  </th>
                  <th scope="col">{t("Record")}</th>
                  <th scope="col">{t("Rule")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col">{t("Status")}</th>
                  <th scope="col">{t("Assigned to")}</th>
                  <th scope="col">{t("Due")}</th>
                  <th scope="col">{t("Reopened")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <IssueRow
                    key={i.id}
                    i={i}
                    picked={picked.has(i.id)}
                    onPick={() => {
                      const next = new Set(picked);
                      if (next.has(i.id)) next.delete(i.id);
                      else next.add(i.id);
                      setPicked(next);
                    }}
                    open={open === i.id}
                    onOpen={() => setOpen(open === i.id ? null : i.id)}
                  />
                ))}
              </tbody>
            </table>
          </ScrollFrame>
          {total > ISSUE_PAGE ? (
            <div className="m2-rfilters">
              <button type="button" className="m2-btn" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - ISSUE_PAGE)); setPicked(new Set()); }}>{t("Previous")}</button>
              <button type="button" className="m2-btn" disabled={offset + ISSUE_PAGE >= total} onClick={() => { setOffset(offset + ISSUE_PAGE); setPicked(new Set()); }}>{t("Next")}</button>
            </div>
          ) : null}
        </Panel>
      )}
      {open ? <IssueDetail id={open} onClose={() => setOpen(null)} /> : null}
    </CcPage>
  );
}

function IssueRow({ i, picked, onPick, open, onOpen }: { i: Issue; picked: boolean; onPick: () => void; open: boolean; onOpen: () => void }) {
  return (
    <tr aria-selected={picked}>
      <td data-label={t("Select")}>
        <input type="checkbox" aria-label={t("Select {key}", { key: i.record_key })} checked={picked} onChange={onPick} />
      </td>
      <th scope="row" className="m2-card-lead">
        <button type="button" className="m2-linkbtn" aria-expanded={open} onClick={onOpen}>
          {moduleText(i.module)} <Mono>{i.record_key}</Mono>
        </button>
      </th>
      <td data-label={t("Rule")}>
        <Mono>{i.check_id}</Mono> {i.message ?? <Dash why={t("The run stored no message for this rule.")} />}
        {i.field ? <span className="m2-meta"> <Mono>{i.field}</Mono></span> : null}
      </td>
      <td data-label={t("Severity")}><Sev severity={i.severity} /></td>
      <td data-label={t("Status")}>
        {statusText(i.status)}
        {i.resolution ? <span className="m2-meta"> {RESOLUTION_TEXT[i.resolution]?.() ?? i.resolution}</span> : null}
      </td>
      <td data-label={t("Assigned to")}>{i.assignee_email ?? <Dash why={t("No one is assigned")} />}</td>
      <td data-label={t("Due")} className="m2-num">
        {i.due_at ? formatDate(i.due_at, "date") : <Dash why={t("No due date")} />}
        {i.sla_state ? <span className="m2-meta"> {SLA_TEXT[i.sla_state]?.() ?? i.sla_state}</span> : null}
      </td>
      <td data-label={t("Reopened")} className="m2-num">{int(i.reopened_count)}</td>
    </tr>
  );
}

function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
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
      toast.show(t("{n} issues updated.", { n: int(r.updated) }));
      void qc.invalidateQueries({ queryKey: ["record-issues"] });
      void qc.invalidateQueries({ queryKey: ["record-issue"] });
      onDone();
    },
    onError: (e) => toast.show(errorSentence(e, t("The issues could not be updated.")), "error"),
  });
  const mayMove = (s: IssueStatus) => (s === "accepted" ? can("approve") : can("assign"));
  const missing = (choices && !resolution) || (resolution === "false_positive" && !note.trim());
  const nothing = !to && who === "-" && !note.trim();
  if (!can("assign") && !can("approve") && !can("analyse")) return null;
  return (
    <form
      className="m2-rfilters"
      aria-label={t("Change the selected issues")}
      data-testid="issues-bulk"
      onSubmit={(e) => { e.preventDefault(); send.mutate(); }}
    >
      <span className="m2-meta">{t("{n} selected", { n: int(ids.length) })}</span>
      <label>
        {t("Move to")}
        <select className="m2-sel" value={to} onChange={(e) => { setTo(e.target.value as IssueStatus | ""); setResolution(""); }}>
          <option value="">{t("Keep the status")}</option>
          {ISSUE_STATUSES.filter(mayMove).map((s) => <option key={s} value={s}>{STATUS_TEXT[s]()}</option>)}
        </select>
      </label>
      {choices ? (
        <label>
          {t("Resolution")}
          <select className="m2-sel" value={resolution} onChange={(e) => setResolution(e.target.value as IssueResolution | "")} required>
            <option value="">{t("Choose")}</option>
            {choices.map((r) => <option key={r} value={r}>{RESOLUTION_TEXT[r]()}</option>)}
          </select>
        </label>
      ) : null}
      {can("assign") ? (
        <label>
          {t("Assign to")}
          <select className="m2-sel" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="-">{t("Keep the assignee")}</option>
            <option value="">{t("No one")}</option>
            {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      ) : null}
      <label>
        {resolution === "false_positive" ? t("Why it is a false positive") : t("Note")}
        <input className="m2-inp" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} required={resolution === "false_positive"} />
      </label>
      <button type="submit" className="m2-btn m2-next" disabled={nothing || !!missing || send.isPending}>{t("Apply")}</button>
    </form>
  );
}

function IssueDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const fixture = useFixture();
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const one = useQuery({ queryKey: ["record-issue", fixture, id], queryFn: () => getIssue(id), staleTime: 30_000, retry });
  const add = useMutation({
    mutationFn: () => commentIssue(id, body.trim()),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["record-issue", fixture, id] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The comment could not be saved.")), "error"),
  });
  const title = one.data ? t("{key} against {rule}", { key: one.data.issue.record_key, rule: one.data.issue.check_id }) : t("Issue");
  return (
    <Panel title={title} meta={one.data ? statusText(one.data.issue.status) : undefined} testId="issues-detail">
      {one.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : one.isError ? (
        status(one.error) === 404 ? <EmptyFrame>{t("This issue no longer exists.")}</EmptyFrame> : <ErrorFrame onRetry={() => void one.refetch()}>{t("The issue could not be read.")}</ErrorFrame>
      ) : (
        <>
          <p className="m2-meta">
            {t("First failed {first}, last failed {last}", {
              first: one.data.issue.first_seen_at ? formatDate(one.data.issue.first_seen_at, "date") : "—",
              last: one.data.issue.last_seen_at ? formatDate(one.data.issue.last_seen_at, "date") : "—",
            })}
          </p>
          <h3 className="m2-h3">{t("Runs")}</h3>
          {one.data.runs.length === 0 ? (
            <Dash why={t("No run has checked this record since it was first found.")} />
          ) : (
            <ol aria-label={t("Runs, newest first")} data-testid="issues-runs">
              {one.data.runs.map((r) => (
                <li key={r.version_id}>
                  {r.run_at ? formatDate(r.run_at, "date") : <Mono>{r.version_id}</Mono>}{" "}
                  <span className="m2-meta">{r.failing ? t("Failing") : t("Clean")}</span>
                </li>
              ))}
            </ol>
          )}
          <h3 className="m2-h3">{t("History")}</h3>
          {one.data.events.length === 0 ? (
            <Dash why={t("Nothing has been done on this issue yet.")} />
          ) : (
            <ol aria-label={t("History, newest first")} data-testid="issues-events">
              {one.data.events.map((ev, k) => <li key={k}>{eventText(ev)} <span className="m2-meta">{ev.user_label ?? "—"}, {formatDate(ev.created_at, "date")}</span></li>)}
            </ol>
          )}
          {can("analyse") ? (
            <form className="m2-rfilters" aria-label={t("Add a comment")} onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <label>
                {t("Comment")}
                <input className="m2-inp" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
              </label>
              <button type="submit" className="m2-btn" disabled={!body.trim() || add.isPending}>{t("Add comment")}</button>
            </form>
          ) : null}
        </>
      )}
      <button type="button" className="m2-btn" onClick={onClose}>{t("Close")}</button>
    </Panel>
  );
}

function eventText(ev: IssueEvent): string {
  if (ev.action === "assign") return ev.to_value ? t("Assigned to {who}", { who: ev.to_value }) : t("Unassigned");
  if (ev.action === "status") {
    const text = t("Moved from {from} to {to}", { from: statusText(ev.from_value ?? ""), to: statusText(ev.to_value ?? "") });
    return ev.note ? `${text}: ${ev.note}` : text;
  }
  return ev.note ?? "";
}
