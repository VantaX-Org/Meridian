"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  assignException, commentException, escalateException, EXCEPTION_PAGE, EXCEPTION_STATUSES, getException, getExceptionMetrics,
  getExceptionRules, getExceptions, getSapMonitor, RESOLUTION_TYPES, resolveException, setExceptionRuleActive,
  type ExceptionRow, type ExceptionRule, type ExceptionStatus,
} from "@/lib/api/v2/exceptions";
import { useFixture } from "@/lib/api/v2/fixture";
import { exportGrid } from "@/lib/api/v2/roles";
import { getAssignable, type AssignableUser } from "@/lib/api/v2/triage";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { downloadCsv, tableCsv } from "@/lib/v2/grid-export";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, SidePanel, Skeleton, Stepper, Tabs, useToast, type ChipTone, type Column } from "../kit";
import { SegBar, type SegTone } from "../kit/viz/SegBar";
import { NewExceptionRule, RaiseException, SEVERITIES, SEV_TEXT } from "./ExceptionForms";
import "../more/more.css";
import "./exceptions.css";

/**
 * Exceptions, native: what went wrong in a business process or an SAP transaction (api/routes/exceptions.py). Each runs under
 * an SLA set by its severity, climbs tiers when escalated and closes with a resolution type and a root cause. The SAP monitor
 * counts the transaction exceptions of the last 24 hours; the rules raise them. Rebuilt from design/v2/screens/Exceptions.tsx.
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

const TYPE_TEXT: Record<string, () => string> = { sap_transaction: () => t("SAP transaction"), custom_business: () => t("Business process") };
const typeText = (s: string) => TYPE_TEXT[s]?.() ?? s;

const RESOLUTION_TEXT: Record<string, () => string> = {
  steward: () => t("Fixed by a steward"),
  auto_resolved: () => t("Fixed automatically"),
  dedup: () => t("Duplicate merged"),
  complex: () => t("Complex fix"),
  custom_rule: () => t("Fixed by a custom rule"),
};

const SEV_TONE: Record<string, ChipTone> = { critical: "bad", high: "bad", medium: "warn", low: "neutral" };
const SEG_TONE: Record<string, SegTone> = { critical: "bad", high: "warn", medium: "data", low: "quiet" };
const Sev = ({ s }: { s: string }) => <Chip tone={SEV_TONE[s] ?? "neutral"}>{SEV_TEXT[s]?.() ?? s}</Chip>;
const Dash = ({ why }: { why: string }) => <span className="nx-ex-dash" title={why} aria-label={why}>—</span>;

const zar = (n: number) => `R ${int(n)}`;
const isOpen = (s: string) => s === "open" || s === "investigating" || s === "pending_approval";
const late = (x: ExceptionRow) => isOpen(x.status) && x.sla_deadline !== null && x.sla_deadline < new Date().toISOString();
// The route stores the user id; show the name when the assignable list knows it.
const who = (id: string | null, people: AssignableUser[] | undefined) => (id ? people?.find((u) => u.id === id)?.name ?? id : null);

function useAssignable() {
  const fixture = useFixture();
  const { can } = useV2Session();
  return useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, enabled: can("assign"), retry });
}

/** Writes need the permission and a live session (not a shared link, not viewing as someone else). */
function useWrite() {
  const s = useV2Session();
  const live = !s.shared && !s.viewAs;
  return { can: (p: string) => live && s.can(p), name: s.name, mayExport: s.can("export") };
}

type Grid = { columns: { key: string; header: string; kind?: "text" | "int" | "pct" }[]; rows: Record<string, string | number | null>[] };

function ExportButtons({ title, route, grid }: { title: string; route: string; grid: () => Grid }) {
  const toast = useToast();
  const go = async (format: "xlsx" | "csv") => {
    try {
      const g = grid();
      const name = format === "csv" ? downloadCsv(route, tableCsv(g.columns, g.rows)) : await exportGrid({ title, route, columns: g.columns, rows: g.rows, total: g.rows.length });
      toast({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(g.rows.length), name }), tone: "good" });
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  return (
    <span className="nx-row" role="group" aria-label={t("Export {title}", { title })}>
      <Button size={32} variant="quiet" icon="download" onClick={() => void go("xlsx")}>{t("Export to Excel")}</Button>
      <Button size={32} variant="quiet" icon="download" onClick={() => void go("csv")}>{t("Export to CSV")}</Button>
    </span>
  );
}

export function exceptionsExport(rows: readonly ExceptionRow[], people: AssignableUser[] | undefined): Grid {
  return {
    columns: [
      { key: "title", header: t("Exception") },
      { key: "type", header: t("Raised by") },
      { key: "ref", header: t("Reference") },
      { key: "severity", header: t("Severity") },
      { key: "status", header: t("Status") },
      { key: "owner", header: t("Assigned to") },
      { key: "sla", header: t("SLA") },
      { key: "zar", header: t("Value at risk"), kind: "int" },
    ],
    rows: rows.map((x) => ({
      title: x.title, type: typeText(x.type), ref: x.source_reference, severity: SEV_TEXT[x.severity]?.() ?? x.severity, status: statusText(x.status),
      owner: who(x.assigned_to, people), sla: x.sla_deadline ? formatDate(x.sla_deadline, "date") : null, zar: x.estimated_impact_zar,
    })),
  };
}

function Section({ title, meta, testid, actions, children }: { title: string; meta?: ReactNode; testid?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="nx-card nx-ex-sec" aria-label={title} data-testid={testid}>
      <header className="nx-ex-head">
        <div className="nx-cell-stack"><h3>{title}</h3>{meta ? <small className="nx-sub">{meta}</small> : null}</div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function WorkExceptions() {
  const fixture = useFixture();
  const { mayExport } = useWrite();
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
  const list = useQuery({ queryKey: ["exceptions", fixture, q], queryFn: () => getExceptions(q), staleTime: 30_000, placeholderData: keepPreviousData, retry });

  const submit = (e: FormEvent) => { e.preventDefault(); setFilter(draft); setPage(1); };

  if (metrics.isPending || list.isPending) return <div className="nx-wk-ledger"><Skeleton lines={6} label={t("Exceptions")} /></div>;
  const failed = metrics.isError ? metrics : list.isError ? list : null;
  if (failed) {
    return (
      <div className="nx-wk-ledger">
        {status(failed.error) === 403 ? (
          <EmptyState heading={t("Exceptions")}>{t("Your role cannot read the exceptions.")}</EmptyState>
        ) : (
          <ErrorState sentence={t("The exceptions could not be read.")} onRetry={() => { void metrics.refetch(); void list.refetch(); }} />
        )}
      </div>
    );
  }
  const m = metrics.data!;
  const { exceptions: items, total } = list.data!;
  const sap = monitor.data?.exceptions.length;
  const step = picked ? 1 : 0;

  const columns: Column<ExceptionRow>[] = [
    {
      id: "title", label: t("Exception"),
      cell: (x) => (
        <span className="nx-cell-stack">
          <button type="button" className="nx-ex-link" aria-expanded={picked === x.id} onClick={(e) => { e.stopPropagation(); setPicked(picked === x.id ? null : x.id); }}>{x.title}</button>
          {x.description ? <small className="nx-sub">{x.description}</small> : null}
        </span>
      ),
      compare: (a, b) => a.title.localeCompare(b.title),
    },
    { id: "type", label: t("Raised by"), cell: (x) => (x.source_reference ? <Code code={x.source_reference} text={typeText(x.type)} /> : typeText(x.type)) },
    { id: "severity", label: t("Severity"), cell: (x) => <Sev s={x.severity} />, compare: (a, b) => SEVERITIES.indexOf(a.severity as never) - SEVERITIES.indexOf(b.severity as never) },
    {
      id: "status", label: t("Status"),
      cell: (x) => (
        <span className="nx-cell-stack">
          {statusText(x.status)}
          {x.escalation_tier && x.escalation_tier > 1 ? <small className="nx-sub">{t("Tier {n}", { n: int(x.escalation_tier) })}</small> : null}
        </span>
      ),
    },
    { id: "owner", label: t("Assigned to"), cell: (x) => who(x.assigned_to, people.data) ?? <Dash why={t("No one is assigned")} /> },
    {
      id: "sla", label: t("SLA"), align: "end",
      cell: (x) => (
        <span className="nx-cell-stack">
          {x.sla_deadline ? formatDate(x.sla_deadline, "date") : <Dash why={t("No SLA is set")} />}
          {late(x) ? <Chip tone="bad">{t("Overdue")}</Chip> : null}
        </span>
      ),
      compare: (a, b) => (a.sla_deadline ?? "").localeCompare(b.sla_deadline ?? ""),
    },
    {
      id: "zar", label: t("Value at risk"), align: "end",
      cell: (x) => (x.estimated_impact_zar === null ? <Dash why={t("No value was estimated for this exception.")} /> : zar(x.estimated_impact_zar)),
      compare: (a, b) => (a.estimated_impact_zar ?? 0) - (b.estimated_impact_zar ?? 0),
    },
  ];

  return (
    <div className="nx-wk-ledger nx-ex">
      <section className="nx-card nx-ex-banner" aria-label={t("Exceptions")} data-testid="exceptions-banner">
        <div className="nx-cell-stack">
          <h2>{t("{n} exceptions still open", { n: int(m.open_count) })}</h2>
          {m.overdue_count ? <p className="nx-ex-why">{t("{n} are past their SLA.", { n: int(m.overdue_count) })}</p> : null}
        </div>
        <dl className="nx-ex-figs">
          <div><dt>{t("Within SLA")}</dt><dd>{`${m.sla_compliance_pct.toFixed(1)}%`}</dd><small>{t("{n} resolved", { n: int(m.resolved_count) })}</small></div>
          <div><dt>{t("Average time to resolve")}</dt><dd>{t("{n} h", { n: m.avg_resolution_hours.toFixed(1) })}</dd></div>
          <div><dt>{t("SAP transactions")}</dt><dd>{sap === undefined ? "—" : int(sap)}</dd><small>{t("Last 24 hours")}</small></div>
        </dl>
        <div className="nx-ex-sev" data-testid="exceptions-severity" aria-label={t("Open exceptions by severity")}>
          <small className="nx-sub">{t("Open exceptions by severity")}: {t("All {n}", { n: int(m.open_count) })}</small>
          <SegBar segs={SEVERITIES.map((s) => ({ key: s, label: SEV_TEXT[s](), value: m.by_severity[s] ?? 0, tone: SEG_TONE[s] }))} format={int} />
        </div>
        {items.length ? (
          <div><Button variant="primary" data-testid="exceptions-primary" onClick={() => setPicked(items[0].id)}>{t("Open the exception with the nearest deadline")}</Button></div>
        ) : null}
      </section>

      <p className="nx-wk-lede">{t("Cases that need a person: a failed job, a stuck posting or a breached promise. Each has a deadline, an owner and a status. Exceptions come from systems and jobs, not from one object, so they carry no run.")}</p>
      <dl className="nx-ex-means">
        {([
          [t("SLA"), t("The deadline to resolve an exception. Overdue means the deadline passed.")],
          [t("Within SLA"), t("Share of resolved exceptions closed before their deadline.")],
          [t("Value at risk"), t("The estimated cost of leaving the exception open. A dash means nobody estimated it.")],
          [t("SAP transactions"), t("Transactions SAP logged as failed in the last 24 hours.")],
        ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <Stepper
        label={t("Exception steps")}
        steps={[
          { id: "open", label: t("Open one"), state: step === 0 ? "current" : "done", detail: `${int(m.open_count)}: ${t("Pick the exception with the nearest deadline.")}` },
          { id: "assign", label: t("Assign or escalate"), state: step === 1 ? "current" : "future", detail: `${int(m.overdue_count)}: ${t("Give it an owner, or raise it a tier. The count shows overdue ones.")}` },
          { id: "resolve", label: t("Resolve"), state: "future", detail: `${int(m.resolved_count)}: ${t("Record how it was fixed and the root cause. The count shows resolved ones.")}` },
        ]}
      />

      <RaiseException />

      <div data-testid="exceptions-tabs">
        <Tabs
          label={t("Show exceptions by status")}
          idBase="nx-ex-tabs"
          value={view}
          onChange={(v) => { setView(v as ExceptionStatus | "all"); setPage(1); }}
          items={[{ id: "all", label: t("All") }, ...EXCEPTION_STATUSES.map((s) => ({ id: s, label: STATUS_TEXT[s]() }))]}
        />
      </div>
      <form className="nx-row-wrap nx-ex-filter" onSubmit={submit} aria-label={t("Filter the exceptions")} data-testid="exceptions-filter">
        <label className="nx-field">
          {t("Severity")}
          <select className="nx-input" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
            <option value="">{t("Any severity")}</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEV_TEXT[s]()}</option>)}
          </select>
        </label>
        <label className="nx-field">
          {t("Raised by")}
          <select className="nx-input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="">{t("Any source")}</option>
            <option value="sap_transaction">{typeText("sap_transaction")}</option>
            <option value="custom_business">{typeText("custom_business")}</option>
          </select>
        </label>
        <Button type="submit" variant="secondary" size={40}>{t("Show exceptions")}</Button>
      </form>

      {items.length === 0 ? (
        <EmptyState heading={t("Exceptions")}>{t("No exceptions match. Change the status or the filter.")}</EmptyState>
      ) : (
        <Section
          title={t("Exceptions")}
          testid="exceptions-table"
          meta={t("{from} to {to} of {n}, nearest SLA first", { from: int((page - 1) * EXCEPTION_PAGE + 1), to: int((page - 1) * EXCEPTION_PAGE + items.length), n: int(total) })}
          actions={mayExport ? <ExportButtons title={t("Exceptions")} route="exceptions" grid={() => exceptionsExport(items, people.data)} /> : null}
        >
          <DataTable rows={items} columns={columns} rowKey={(x) => x.id} rowLabel={(x) => x.title} caption={t("Exceptions")} total={total} onOpenRow={(x) => setPicked(x.id)} />
          {total > EXCEPTION_PAGE ? (
            <div className="nx-row">
              <Button size={32} variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>{t("Previous")}</Button>
              <Button size={32} variant="secondary" disabled={page * EXCEPTION_PAGE >= total} onClick={() => setPage(page + 1)}>{t("Next")}</Button>
            </div>
          ) : null}
        </Section>
      )}

      <Rules />

      <SidePanel open={picked !== null} onClose={() => setPicked(null)} title={t("Exception")} footer={<Button variant="secondary" onClick={() => setPicked(null)}>{t("Close")}</Button>}>
        {picked ? <Detail id={picked} /> : null}
      </SidePanel>
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const fixture = useFixture();
  const { can, name } = useWrite();
  const toast = useToast();
  const qc = useQueryClient();
  const people = useAssignable();
  const [owner, setOwner] = useState("");
  const [reason, setReason] = useState("");
  const [fix, setFix] = useState({ resolution_type: "", resolution_notes: "", root_cause_category: "" });
  const [body, setBody] = useState("");
  const one = useQuery({ queryKey: ["exception", fixture, id], queryFn: () => getException(id), staleTime: 30_000, retry });
  const done = (text: string) => {
    toast({ text, tone: "good" });
    void qc.invalidateQueries({ queryKey: ["exception", fixture, id] });
    void qc.invalidateQueries({ queryKey: ["exceptions"] });
    void qc.invalidateQueries({ queryKey: ["exception-metrics"] });
  };
  const fail = (fallback: string) => (e: unknown) => toast({ text: errorSentence(e, fallback), tone: "bad" });
  const assign = useMutation({
    mutationFn: () => assignException(id, owner, people.data?.find((u) => u.id === owner)?.name ?? owner),
    onSuccess: () => done(t("Exception assigned.")),
    onError: fail(t("The exception could not be assigned.")),
  });
  const escalate = useMutation({
    mutationFn: () => escalateException(id, reason.trim()),
    onSuccess: (r) => { setReason(""); done(t("Escalated to tier {n}.", { n: int(r.escalation_tier) })); },
    onError: fail(t("The exception could not be escalated.")),
  });
  const resolve = useMutation({
    mutationFn: () => resolveException(id, { ...fix, resolution_notes: fix.resolution_notes.trim(), root_cause_category: fix.root_cause_category.trim() }),
    onSuccess: () => done(t("Exception resolved.")),
    onError: fail(t("The exception could not be resolved.")),
  });
  const comment = useMutation({
    mutationFn: () => commentException(id, body.trim(), name ?? ""),
    onSuccess: () => { setBody(""); void qc.invalidateQueries({ queryKey: ["exception", fixture, id] }); },
    onError: fail(t("The comment could not be saved.")),
  });

  if (one.isPending) return <Skeleton lines={4} label={t("Exception")} />;
  if (one.isError) {
    return status(one.error) === 404
      ? <EmptyState heading={t("Exception")}>{t("This exception no longer exists.")}</EmptyState>
      : <ErrorState sentence={t("The exception could not be read.")} onRetry={() => void one.refetch()} />;
  }
  const x = one.data;
  const tier = x.escalation_tier ?? 1;
  const live = isOpen(x.status);
  return (
    <div className="nx-ex-detail" data-testid="exceptions-detail">
      <div className="nx-cell-stack">
        <h3>{x.title || t("Exception")}</h3>
        <span className="nx-row-wrap"><Chip>{statusText(x.status)}</Chip><Sev s={x.severity} />{late(x) ? <Chip tone="bad">{t("Overdue")}</Chip> : null}</span>
      </div>
      <p>{x.description ?? <Dash why={t("No description was stored.")} />}</p>
      <small className="nx-sub">{t("Raised {when} in {system}", { when: x.created_at ? formatDate(x.created_at, "date") : "—", system: x.source_system ?? "—" })}</small>
      {x.linked_finding ? (
        <p className="nx-row-wrap" data-testid="exceptions-finding">
          {t("Linked finding")}: <Code code={x.linked_finding.check_id} text={moduleText(x.linked_finding.module)} /> <Sev s={x.linked_finding.severity} />
          {x.linked_finding.pass_rate !== null ? <small className="nx-sub">{t("{n}% pass", { n: x.linked_finding.pass_rate.toFixed(1) })}</small> : null}
        </p>
      ) : null}
      {x.resolution_type ? (
        <p className="nx-cell-stack" data-testid="exceptions-resolution">
          <Code code={x.resolution_type} text={RESOLUTION_TEXT[x.resolution_type]?.() ?? x.resolution_type} />
          {x.root_cause_category ? <small className="nx-sub">{t("Root cause: {c}", { c: x.root_cause_category })}</small> : null}
          {x.resolution_notes ? <small className="nx-sub">{x.resolution_notes}</small> : null}
        </p>
      ) : null}

      {live && can("assign") ? (
        <form className="nx-ex-form" aria-label={t("Assign the exception")} onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
          <label className="nx-field">
            {t("Assign to")}
            <select className="nx-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("Choose")}</option>
              {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <Button type="submit" variant="secondary" size={32} disabled={!owner} loading={assign.isPending}>{t("Assign")}</Button>
          <small className="nx-sub">{t("Assign makes the person the owner. The exception stays open.")}</small>
        </form>
      ) : null}
      {live && can("approve") ? (
        <>
          <form className="nx-ex-form" aria-label={t("Escalate the exception")} onSubmit={(e) => { e.preventDefault(); escalate.mutate(); }}>
            <label className="nx-field">
              {t("Why escalate")}
              <input className="nx-input" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </label>
            <Button type="submit" variant="secondary" size={32} disabled={!reason.trim() || tier >= 4} loading={escalate.isPending}>
              {t("Escalate to tier {n}", { n: int(Math.min(tier + 1, 4)) })}
            </Button>
          </form>
          <form className="nx-ex-form" aria-label={t("Resolve the exception")} onSubmit={(e) => { e.preventDefault(); resolve.mutate(); }}>
            <label className="nx-field">
              {t("Resolution")}
              <select className="nx-input" value={fix.resolution_type} onChange={(e) => setFix({ ...fix, resolution_type: e.target.value })} required>
                <option value="">{t("Choose")}</option>
                {RESOLUTION_TYPES.map((r) => <option key={r} value={r}>{RESOLUTION_TEXT[r]()}</option>)}
              </select>
            </label>
            <label className="nx-field">
              {t("Root cause")}
              <input className="nx-input" value={fix.root_cause_category} maxLength={200} onChange={(e) => setFix({ ...fix, root_cause_category: e.target.value })} />
            </label>
            <label className="nx-field">
              {t("What was done")}
              <input className="nx-input" value={fix.resolution_notes} maxLength={4000} onChange={(e) => setFix({ ...fix, resolution_notes: e.target.value })} />
            </label>
            <Button type="submit" variant="primary" size={32} disabled={!fix.resolution_type} loading={resolve.isPending}>{t("Resolve")}</Button>
            <small className="nx-sub">{t("Escalate raises the exception one tier. Resolve closes it and records how it was fixed.")}</small>
          </form>
        </>
      ) : null}

      <h4>{t("Comments")}</h4>
      {x.comments.length === 0 ? (
        <Dash why={t("No one has commented yet.")} />
      ) : (
        <ol className="nx-ex-comments" aria-label={t("Comments")} data-testid="exceptions-comments">
          {x.comments.map((c) => (
            <li key={c.id}>{c.text} <small className="nx-sub">{c.user_name === "system" ? t("Meridian") : c.user_name ?? "—"}, {c.created_at ? formatDate(c.created_at, "date") : "—"}</small></li>
          ))}
        </ol>
      )}
      {can("analyse") ? (
        <form className="nx-ex-form" aria-label={t("Add a comment")} onSubmit={(e) => { e.preventDefault(); comment.mutate(); }}>
          <label className="nx-field">
            {t("Comment")}
            <input className="nx-input" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary" size={32} disabled={!body.trim()} loading={comment.isPending}>{t("Add comment")}</Button>
        </form>
      ) : null}
    </div>
  );
}

function rulesExport(rows: readonly ExceptionRule[]): Grid {
  return {
    columns: [
      { key: "name", header: t("Rule") },
      { key: "object", header: t("Object") },
      { key: "condition", header: t("Condition") },
      { key: "severity", header: t("Severity") },
      { key: "state", header: t("State") },
    ],
    rows: rows.map((r) => ({
      name: r.name, object: r.object_type ? moduleText(r.object_type) : null, condition: r.condition,
      severity: r.severity ? SEV_TEXT[r.severity]?.() ?? r.severity : null, state: r.is_active ? t("On") : t("Off"),
    })),
  };
}

function Rules() {
  const fixture = useFixture();
  const { can, mayExport } = useWrite();
  const toast = useToast();
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["exception-rules", fixture], queryFn: getExceptionRules, staleTime: 60_000, retry });
  const toggle = useMutation({
    mutationFn: (r: { id: string; on: boolean }) => setExceptionRuleActive(r.id, r.on),
    onSuccess: (r) => {
      toast({ text: r.is_active ? t("Rule switched on.") : t("Rule switched off."), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["exception-rules", fixture] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The rule could not be changed.")), tone: "bad" }),
  });
  if (rules.isPending) return <Skeleton lines={3} label={t("Rules that raise exceptions")} />;
  if (rules.isError) return status(rules.error) === 403 ? null : <ErrorState sentence={t("The exception rules could not be read.")} onRetry={() => void rules.refetch()} />;
  const list = rules.data.rules;
  const manage = can("manage_rules");
  const columns: Column<ExceptionRule>[] = [
    {
      id: "name", label: t("Rule"),
      cell: (r) => <span className="nx-cell-stack">{r.name}{r.description ? <small className="nx-sub">{r.description}</small> : null}</span>,
      compare: (a, b) => a.name.localeCompare(b.name),
    },
    { id: "object", label: t("Object"), cell: (r) => (r.object_type ? <Code code={r.object_type} text={moduleText(r.object_type)} /> : <Dash why={t("The rule names no object.")} />) },
    { id: "condition", label: t("Condition"), cell: (r) => (r.condition ? <code className="nx-mono">{r.condition}</code> : <Dash why={t("The rule stores no condition.")} />) },
    { id: "severity", label: t("Severity"), cell: (r) => (r.severity ? <Sev s={r.severity} /> : <Dash why={t("No severity is set.")} />) },
    {
      id: "state", label: t("State"),
      cell: (r) => (manage ? (
        <Button size={32} variant={r.is_active ? "primary" : "secondary"} aria-pressed={r.is_active} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: r.id, on: !r.is_active })}>
          {r.is_active ? t("On") : t("Off")}
        </Button>
      ) : (r.is_active ? t("On") : t("Off"))),
    },
  ];
  return (
    <Section
      title={t("Rules that raise exceptions")}
      testid="exceptions-rules"
      meta={t("{n} on, {m} off", { n: int(list.filter((r) => r.is_active).length), m: int(list.filter((r) => !r.is_active).length) })}
      actions={mayExport && list.length ? <ExportButtons title={t("Rules that raise exceptions")} route="exception-rules" grid={() => rulesExport(list)} /> : null}
    >
      <NewExceptionRule />
      {list.length === 0 ? (
        <EmptyState heading={t("Rules that raise exceptions")}>{t("No exception rules are defined yet.")}</EmptyState>
      ) : (
        <DataTable rows={list} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => r.name} caption={t("Rules that raise exceptions")} />
      )}
    </Section>
  );
}
