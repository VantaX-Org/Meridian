"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  assignException, commentException, escalateException, EXCEPTION_PAGE, EXCEPTION_STATUSES, getException, getExceptionMetrics,
  getExceptionRules, getExceptions, getSapMonitor, RESOLUTION_TYPES, resolveException, setExceptionRuleActive,
  type ExceptionRow, type ExceptionStatus,
} from "@/lib/api/v2/exceptions";
import { useFixture } from "@/lib/api/v2/fixture";
import { getAssignable, type AssignableUser } from "@/lib/api/v2/triage";
import { formatDate } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Consequence, FixHead, FlowSteps, MoreDetail } from "../FixParts";
import { Dash, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";
import { WorkTabs } from "./WorkTabs";
import { TableExport } from "@/design/v2/TableExport";

/**
 * Exceptions: what went wrong in a business process or an SAP transaction (api/routes/exceptions.py). Each one runs
 * under an SLA set by its severity, climbs tiers when escalated and closes with a resolution type and a root cause.
 * The SAP monitor counts the transaction exceptions of the last 24 hours; the rules raise them.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

const STATUS_TEXT: Record<ExceptionStatus, () => string> = {
  open: () => t("Open"),
  investigating: () => t("Investigating"),
  pending_approval: () => t("Waiting for approval"),
  resolved: () => t("Resolved"),
  verified: () => t("Verified"),
  closed: () => t("Closed"),
};
const statusText = (s: string) => STATUS_TEXT[s as ExceptionStatus]?.() ?? s;

const TYPE_TEXT: Record<string, () => string> = {
  sap_transaction: () => t("SAP transaction"),
  custom_business: () => t("Business process"),
};
const typeText = (s: string) => TYPE_TEXT[s]?.() ?? s;

const RESOLUTION_TEXT: Record<string, () => string> = {
  steward: () => t("Fixed by a steward"),
  auto_resolved: () => t("Fixed automatically"),
  dedup: () => t("Duplicate merged"),
  complex: () => t("Complex fix"),
  custom_rule: () => t("Fixed by a custom rule"),
};

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEV_TEXT: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

const zar = (n: number) => `R ${int(n)}`;
const open = (s: string) => s === "open" || s === "investigating" || s === "pending_approval";
// The route stores the user id; show the name when the assignable list knows it.
const who = (id: string | null, people: AssignableUser[] | undefined) => (id ? people?.find((u) => u.id === id)?.name ?? id : null);

function useAssignable() {
  const fixture = useFixture();
  const { can } = useV2Session();
  return useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, enabled: can("assign"), retry });
}

export function Exceptions() {
  const fixture = useFixture();
  const [view, setView] = useUrlParam<ExceptionStatus | "all">("status", "open", [...EXCEPTION_STATUSES, "all"]);
  const tab: ExceptionStatus | "" = view === "all" ? "" : view;
  const [draft, setDraft] = useState({ severity: "", type: "" });
  const [filter, setFilter] = useState(draft);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);
  const people = useAssignable();
  const q = { status: tab, ...filter, page };
  const metrics = useQuery({ queryKey: ["exception-metrics", fixture], queryFn: getExceptionMetrics, staleTime: 30_000, retry });
  const monitor = useQuery({ queryKey: ["exception-sap-monitor", fixture], queryFn: getSapMonitor, staleTime: 60_000, retry });
  const list = useQuery({
    queryKey: ["exceptions", fixture, q],
    queryFn: () => getExceptions(q),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilter(draft);
    setPage(1);
  };

  if (metrics.isPending || list.isPending) return <CcPage><PageTitle sub={t("Exceptions")}>{t("Work")}</PageTitle><WorkTabs current="exceptions" /><Skeleton width="100%" height={320} /></CcPage>;
  const failed = metrics.isError ? metrics : list.isError ? list : null;
  if (failed) {
    return (
      <CcPage>
        <PageTitle sub={t("Exceptions")}>{t("Work")}</PageTitle><WorkTabs current="exceptions" />
        {status(failed.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the exceptions.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => { void metrics.refetch(); void list.refetch(); }}>{t("The exceptions could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const m = metrics.data!;
  const { exceptions: items, total } = list.data!;
  const sap = monitor.data?.exceptions.length;

  return (
    <CcPage>
      <PageTitle sub={t("Exceptions")}>{t("Work")}</PageTitle><WorkTabs current="exceptions" />
      <CcBanner
        eyebrow={t("Exceptions")}
        headline={t("{n} exceptions still open", { n: int(m.open_count) })}
        why={m.overdue_count ? t("{n} are past their SLA.", { n: int(m.overdue_count) }) : undefined}
        figs={[
          { label: t("Within SLA"), value: `${m.sla_compliance_pct.toFixed(1)}%`, note: t("{n} resolved", { n: int(m.resolved_count) }) },
          { label: t("Average time to resolve"), value: t("{n} h", { n: m.avg_resolution_hours.toFixed(1) }) },
          { label: t("SAP transactions"), value: sap === undefined ? "—" : int(sap), note: t("Last 24 hours") },
        ]}
        action={items.length ? <button type="button" className="m2-btn m2-strong" data-testid="exceptions-primary" onClick={() => setPicked(items[0].id)}>{t("Open the exception with the nearest deadline")}</button> : undefined}
        testId="exceptions-banner"
        label={t("Exceptions")}
      />
      <FixHead
        lede={t("Cases that need a person: a failed job, a stuck posting or a breached promise. Each has a deadline, an owner and a status. Exceptions come from systems and jobs, not from one object, so they carry no run.")}
        means={[
          [t("SLA"), t("The deadline to resolve an exception. Overdue means the deadline passed.")],
          [t("Within SLA"), t("Share of resolved exceptions closed before their deadline.")],
          [t("Value at risk"), t("The estimated cost of leaving the exception open. A dash means nobody estimated it.")],
          [t("SAP transactions"), t("Transactions SAP logged as failed in the last 24 hours.")],
        ]}
      />
      <FlowSteps
        label={t("Exception steps")}
        current={picked ? 1 : 0}
        steps={[
          { label: t("Open one"), count: int(m.open_count), hint: t("Pick the exception with the nearest deadline.") },
          { label: t("Assign or escalate"), count: int(m.overdue_count), hint: t("Give it an owner, or raise it a tier. The count shows overdue ones.") },
          { label: t("Resolve"), count: int(m.resolved_count), hint: t("Record how it was fixed and the root cause. The count shows resolved ones.") },
        ]}
      />
      <div className="m2-rfilters" role="group" aria-label={t("Show exceptions by status")} data-testid="exceptions-tabs">
        {(["", ...EXCEPTION_STATUSES] as const).map((s) => (
          <button key={s || "all"} type="button" className="m2-btn" aria-pressed={tab === s} onClick={() => { setView(s || "all"); setPage(1); }}>
            {s ? STATUS_TEXT[s]() : t("All")}
          </button>
        ))}
      </div>
      <form className="m2-rfilters" onSubmit={submit} aria-label={t("Filter the exceptions")} data-testid="exceptions-filter">
        <label>
          {t("Severity")}
          <select className="m2-sel" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
            <option value="">{t("Any severity")}</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEV_TEXT[s]()}</option>)}
          </select>
        </label>
        <label>
          {t("Raised by")}
          <select className="m2-sel" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="">{t("Any source")}</option>
            <option value="sap_transaction">{typeText("sap_transaction")}</option>
            <option value="custom_business">{typeText("custom_business")}</option>
          </select>
        </label>
        <button type="submit" className="m2-btn">{t("Show exceptions")}</button>
      </form>
      {items.length === 0 ? (
        <EmptyFrame>{t("No exceptions match. Change the status or the filter.")}</EmptyFrame>
      ) : (
        <Panel
          title={t("Exceptions")}
          meta={t("{from} to {to} of {n}, nearest SLA first", { from: int((page - 1) * EXCEPTION_PAGE + 1), to: int((page - 1) * EXCEPTION_PAGE + items.length), n: int(total) })}
          testId="exceptions-table"
        >
          <ScrollFrame label={t("Exceptions")}>
            <TableExport><table className="m2-tbl m2-cards">
              <caption className="m2-sr">{t("Exceptions")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("Exception")}</th>
                  <th scope="col">{t("Raised by")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col">{t("Status")}</th>
                  <th scope="col">{t("Assigned to")}</th>
                  <th scope="col">{t("SLA")}</th>
                  <th scope="col">{t("Value at risk")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <Row key={x.id} x={x} people={people.data} open={picked === x.id} onOpen={() => setPicked(picked === x.id ? null : x.id)} />
                ))}
              </tbody>
            </table></TableExport>
          </ScrollFrame>
          {total > EXCEPTION_PAGE ? (
            <div className="m2-rfilters">
              <button type="button" className="m2-btn" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("Previous")}</button>
              <button type="button" className="m2-btn" disabled={page * EXCEPTION_PAGE >= total} onClick={() => setPage(page + 1)}>{t("Next")}</button>
            </div>
          ) : null}
        </Panel>
      )}
      {picked ? <Detail id={picked} onClose={() => setPicked(null)} /> : null}
      <MoreDetail title={t("Severity chart and the rules that raise exceptions")}>
        <Panel title={t("Open exceptions by severity")} meta={t("All {n}", { n: int(m.open_count) })} testId="exceptions-severity">
          <CcHBars
            label={t("Open exceptions by severity")}
            rows={SEVERITIES.map((s) => ({ key: s, label: SEV_TEXT[s](), value: m.by_severity[s] ?? 0, text: int(m.by_severity[s] ?? 0), tone: s === "critical" ? "crit" : s === "high" ? "warn" : undefined }))}
          />
        </Panel>
        <Rules />
      </MoreDetail>
    </CcPage>
  );
}

function Row({ x, people, open: expanded, onOpen }: { x: ExceptionRow; people: AssignableUser[] | undefined; open: boolean; onOpen: () => void }) {
  const late = open(x.status) && x.sla_deadline !== null && x.sla_deadline < new Date().toISOString();
  return (
    <tr>
      <th scope="row" className="m2-card-lead">
        <button type="button" className="m2-linkbtn" aria-expanded={expanded} onClick={onOpen}>{x.title}</button>
        {x.description ? <span className="m2-meta"> {x.description}</span> : null}
      </th>
      <td data-label={t("Raised by")}>
        {typeText(x.type)}
        {x.source_reference ? <span className="m2-meta"> <Mono>{x.source_reference}</Mono></span> : null}
      </td>
      <td data-label={t("Severity")}><Sev severity={x.severity} /></td>
      <td data-label={t("Status")}>
        {statusText(x.status)}
        {x.escalation_tier && x.escalation_tier > 1 ? <span className="m2-meta"> {t("Tier {n}", { n: int(x.escalation_tier) })}</span> : null}
      </td>
      <td data-label={t("Assigned to")}>{who(x.assigned_to, people) ?? <Dash why={t("No one is assigned")} />}</td>
      <td data-label={t("SLA")} className="m2-num">
        {x.sla_deadline ? formatDate(x.sla_deadline, "date") : <Dash why={t("No SLA is set")} />}
        {late ? <span className="m2-meta"> {t("Overdue")}</span> : null}
      </td>
      <td data-label={t("Value at risk")} className="m2-num">
        {x.estimated_impact_zar === null ? <Dash why={t("No value was estimated for this exception.")} /> : zar(x.estimated_impact_zar)}
      </td>
    </tr>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const fixture = useFixture();
  const { can, name } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const people = useAssignable();
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [fix, setFix] = useState({ resolution_type: "", resolution_notes: "", root_cause_category: "" });
  const [body, setBody] = useState("");
  const one = useQuery({ queryKey: ["exception", fixture, id], queryFn: () => getException(id), staleTime: 30_000, retry });
  const done = (msg: string) => () => {
    toast.show(msg);
    void qc.invalidateQueries({ queryKey: ["exception", fixture, id] });
    void qc.invalidateQueries({ queryKey: ["exceptions"] });
    void qc.invalidateQueries({ queryKey: ["exception-metrics"] });
  };
  const fail = (msg: string) => (e: unknown) => toast.show(errorSentence(e, msg), "error");
  const assign = useMutation({
    mutationFn: () => assignException(id, owner, people.data?.find((u) => u.id === owner)?.name ?? owner),
    onSuccess: done(t("Exception assigned.")),
    onError: fail(t("The exception could not be assigned.")),
  });
  const escalate = useMutation({
    mutationFn: () => escalateException(id, reason.trim()),
    onSuccess: (r) => { setReason(""); done(t("Escalated to tier {n}.", { n: int(r.escalation_tier) }))(); },
    onError: fail(t("The exception could not be escalated.")),
  });
  const resolve = useMutation({
    mutationFn: () => resolveException(id, { ...fix, resolution_notes: fix.resolution_notes.trim(), root_cause_category: fix.root_cause_category.trim() }),
    onSuccess: done(t("Exception resolved.")),
    onError: fail(t("The exception could not be resolved.")),
  });
  const comment = useMutation({
    mutationFn: () => commentException(id, body.trim(), name ?? ""),
    onSuccess: () => { setBody(""); void qc.invalidateQueries({ queryKey: ["exception", fixture, id] }); },
    onError: fail(t("The comment could not be saved.")),
  });

  const x = one.data;
  return (
    <Panel title={x?.title ?? t("Exception")} meta={x ? statusText(x.status) : undefined} testId="exceptions-detail">
      {one.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : one.isError ? (
        status(one.error) === 404 ? <EmptyFrame>{t("This exception no longer exists.")}</EmptyFrame> : <ErrorFrame onRetry={() => void one.refetch()}>{t("The exception could not be read.")}</ErrorFrame>
      ) : x ? (
        <>
          <p>{x.description ?? <Dash why={t("No description was stored.")} />}</p>
          <p className="m2-meta">
            {t("Raised {when} in {system}", { when: x.created_at ? formatDate(x.created_at, "date") : "—", system: x.source_system ?? "—" })}
          </p>
          {x.linked_finding ? (
            <p data-testid="exceptions-finding">
              {t("Linked finding")}: {moduleText(x.linked_finding.module)} <Mono>{x.linked_finding.check_id}</Mono> <Sev severity={x.linked_finding.severity} />
              {x.linked_finding.pass_rate !== null ? <span className="m2-meta"> {t("{n}% pass", { n: x.linked_finding.pass_rate.toFixed(1) })}</span> : null}
            </p>
          ) : null}
          {x.resolution_type ? (
            <p data-testid="exceptions-resolution">
              {RESOLUTION_TEXT[x.resolution_type]?.() ?? x.resolution_type}
              {x.root_cause_category ? <span className="m2-meta"> {t("Root cause: {c}", { c: x.root_cause_category })}</span> : null}
              {x.resolution_notes ? <span className="m2-meta"> {x.resolution_notes}</span> : null}
            </p>
          ) : null}
          {open(x.status) && can("assign") ? (
            <form className="m2-rfilters" aria-label={t("Assign the exception")} onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
              <label>
                {t("Assign to")}
                <select className="m2-sel" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">{t("Choose")}</option>
                  {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <button type="submit" className="m2-btn" disabled={!owner || assign.isPending}>{t("Assign")}</button>
            </form>
          ) : null}
          {open(x.status) && can("assign") ? <Consequence>{t("Assign makes the person the owner. The exception stays open.")}</Consequence> : null}
          {open(x.status) && can("approve") ? (
            <>
              <form className="m2-rfilters" aria-label={t("Escalate the exception")} onSubmit={(e) => { e.preventDefault(); escalate.mutate(); }}>
                <label>
                  {t("Why escalate")}
                  <input className="m2-inp" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button type="submit" className="m2-btn" disabled={!reason.trim() || (x.escalation_tier ?? 1) >= 4 || escalate.isPending}>
                  {t("Escalate to tier {n}", { n: int(Math.min((x.escalation_tier ?? 1) + 1, 4)) })}
                </button>
              </form>
              <form className="m2-rfilters" aria-label={t("Resolve the exception")} onSubmit={(e) => { e.preventDefault(); resolve.mutate(); }}>
                <label>
                  {t("Resolution")}
                  <select className="m2-sel" value={fix.resolution_type} onChange={(e) => setFix({ ...fix, resolution_type: e.target.value })} required>
                    <option value="">{t("Choose")}</option>
                    {RESOLUTION_TYPES.map((r) => <option key={r} value={r}>{RESOLUTION_TEXT[r]()}</option>)}
                  </select>
                </label>
                <label>
                  {t("Root cause")}
                  <input className="m2-inp" value={fix.root_cause_category} maxLength={200} onChange={(e) => setFix({ ...fix, root_cause_category: e.target.value })} />
                </label>
                <label>
                  {t("What was done")}
                  <input className="m2-inp" value={fix.resolution_notes} maxLength={4000} onChange={(e) => setFix({ ...fix, resolution_notes: e.target.value })} />
                </label>
                <button type="submit" className="m2-btn m2-next" disabled={!fix.resolution_type || resolve.isPending}>{t("Resolve")}</button>
              </form>
              <Consequence>{t("Escalate raises the exception one tier. Resolve closes it and records how it was fixed.")}</Consequence>
            </>
          ) : null}
          <h3 className="m2-h3">{t("Comments")}</h3>
          {x.comments.length === 0 ? (
            <Dash why={t("No one has commented yet.")} />
          ) : (
            <ol aria-label={t("Comments")} data-testid="exceptions-comments">
              {x.comments.map((c) => (
                <li key={c.id}>{c.text} <span className="m2-meta">{c.user_name === "system" ? t("Meridian") : c.user_name ?? "—"}, {c.created_at ? formatDate(c.created_at, "date") : "—"}</span></li>
              ))}
            </ol>
          )}
          {can("analyse") ? <form className="m2-rfilters" aria-label={t("Add a comment")} onSubmit={(e) => { e.preventDefault(); comment.mutate(); }}>
            <label>
              {t("Comment")}
              <input className="m2-inp" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
            </label>
            <button type="submit" className="m2-btn" disabled={!body.trim() || comment.isPending}>{t("Add comment")}</button>
          </form> : null}
        </>
      ) : null}
      <button type="button" className="m2-btn" onClick={onClose}>{t("Close")}</button>
    </Panel>
  );
}

function Rules() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["exception-rules", fixture], queryFn: getExceptionRules, staleTime: 60_000, retry });
  const toggle = useMutation({
    mutationFn: (r: { id: string; on: boolean }) => setExceptionRuleActive(r.id, r.on),
    onSuccess: (r) => {
      toast.show(r.is_active ? t("Rule switched on.") : t("Rule switched off."));
      void qc.invalidateQueries({ queryKey: ["exception-rules", fixture] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The rule could not be changed.")), "error"),
  });
  if (rules.isPending) return <Skeleton width="100%" height={120} />;
  if (rules.isError) return status(rules.error) === 403 ? null : <ErrorFrame onRetry={() => void rules.refetch()}>{t("The exception rules could not be read.")}</ErrorFrame>;
  const list = rules.data.rules;
  return (
    <Panel title={t("Rules that raise exceptions")} meta={t("{n} on, {m} off", { n: int(list.filter((r) => r.is_active).length), m: int(list.filter((r) => !r.is_active).length) })} testId="exceptions-rules">
      {list.length === 0 ? (
        <EmptyFrame>{t("No exception rules are defined yet.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Rules that raise exceptions")}>
          <TableExport><table className="m2-tbl m2-cards">
            <caption className="m2-sr">{t("Rules that raise exceptions")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Rule")}</th>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Condition")}</th>
                <th scope="col">{t("Severity")}</th>
                <th scope="col">{t("State")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="m2-card-lead">
                    {r.name}
                    {r.description ? <span className="m2-meta"> {r.description}</span> : null}
                  </th>
                  <td data-label={t("Object")}>{r.object_type ? moduleText(r.object_type) : <Dash why={t("The rule names no object.")} />}</td>
                  <td data-label={t("Condition")}>{r.condition ? <Mono>{r.condition}</Mono> : <Dash why={t("The rule stores no condition.")} />}</td>
                  <td data-label={t("Severity")}>{r.severity ? <Sev severity={r.severity} /> : <Dash why={t("No severity is set.")} />}</td>
                  <td data-label={t("State")}>
                    {can("manage_rules") ? (
                      <button type="button" className="m2-btn" aria-pressed={r.is_active} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: r.id, on: !r.is_active })}>
                        {r.is_active ? t("On") : t("Off")}
                      </button>
                    ) : r.is_active ? t("On") : t("Off")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></TableExport>
        </ScrollFrame>
      )}
    </Panel>
  );
}
