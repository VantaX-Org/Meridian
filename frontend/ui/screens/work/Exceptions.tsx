"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBilling } from "@/lib/api/v2/admin";
import {
  EXCEPTION_PAGE, EXCEPTION_STATUSES, RESOLUTION_TYPES, assignException, commentException, createExceptionRule, escalateException,
  getException, getExceptionMetrics, getExceptionRules, getExceptions, getSapMonitor, raiseException, resolveException, setExceptionRuleActive,
  type ExceptionRow, type ExceptionRule,
} from "@/lib/api/v2/exceptions";
import { exportExceptions } from "@/lib/api/v2/work";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { money } from "@/lib/v2/format";
import { Button, Card, Chip, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Sheet, Skeleton, StatTile, Tabs, useAletheia, useAletheiaScope, useStacked } from "@/ui/kit";
import { day, sevLabel, useDo } from "./shared";

const STATUS_TEXT = (s: string) => ({ open: t("Open"), investigating: t("Investigating"), pending_approval: t("Pending approval"), resolved: t("Resolved"), verified: t("Verified"), closed: t("Closed") })[s] ?? s;
const SEVS = ["", "critical", "high", "medium", "low"];

function Detail({ id }: { id: string }) {
  const fx = useFixture();
  const run = useDo();
  const [note, setNote] = useState("");
  const [why, setWhy] = useState("");
  const [cmt, setCmt] = useState("");
  const [kind, setKind] = useState<string>(RESOLUTION_TYPES[0]);
  const [cause, setCause] = useState("");
  const [owner, setOwner] = useState("");
  const q = useQuery({ queryKey: ["v2", "exception", fx, id], queryFn: () => getException(id), retry: false });
  const e = q.data;
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading the exception")} />;
  if (q.isError || !e) return <ErrorState heading={t("The exception could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  return (
    <>
      <h3>{e.title}</h3>
      <dl className="mx-tiles">
        <StatTile label={t("Status")} value={STATUS_TEXT(e.status)} />
        <StatTile label={t("Severity")} value={sevLabel(e.severity)} />
        <StatTile label={t("Impact")} value={e.estimated_impact_zar == null ? "-" : money(e.estimated_impact_zar, "ZAR")} />
      </dl>
      {e.description ? <p className="mx-muted">{e.description}</p> : null}
      {e.linked_finding ? <p><FieldChip code={e.linked_finding.check_id} description={e.linked_finding.module} /></p> : null}
      <Card title={t("Assign")}>
        <Field label={t("Owner")}><Input value={owner} onChange={(x) => setOwner(x.target.value)} /></Field>
        <Button variant="secondary" disabled={!owner.trim()} onClick={() => void run(() => assignException(id, owner.trim(), owner.trim()), () => t("Assigned."))}>{t("Assign")}</Button>
      </Card>
      <Card title={t("Escalate")}>
        <Field label={t("Reason")}><Input value={why} onChange={(x) => setWhy(x.target.value)} /></Field>
        <Button variant="secondary" disabled={!why.trim()} onClick={() => void run(() => escalateException(id, why.trim()), () => t("Escalated."))}>{t("Escalate")}</Button>
      </Card>
      <Card title={t("Resolve")}>
        <Field label={t("How it was resolved")}><Select value={kind} onChange={(x) => setKind(x.target.value)} options={RESOLUTION_TYPES.map((r) => ({ value: r, label: r.replace(/_/g, " ") }))} /></Field>
        <Field label={t("Root cause")}><Input value={cause} onChange={(x) => setCause(x.target.value)} /></Field>
        <Field label={t("Notes")}><Input value={note} onChange={(x) => setNote(x.target.value)} /></Field>
        <Button variant="primary" disabled={!note.trim() || !cause.trim()} onClick={() => void run(() => resolveException(id, { resolution_type: kind, resolution_notes: note.trim(), root_cause_category: cause.trim() }), () => t("Resolved."))}>{t("Resolve")}</Button>
      </Card>
      <Card title={t("Comments")}>
        {e.comments.length ? <ul className="mx-list">{e.comments.map((c) => <li key={c.id}>{c.user_name ?? t("Someone")} {day(c.created_at ?? "")}: {c.text}</li>)}</ul> : <p className="mx-muted">{t("No comments yet.")}</p>}
        <Field label={t("Add a comment")}><Input value={cmt} onChange={(x) => setCmt(x.target.value)} /></Field>
        <Button variant="ghost" disabled={!cmt.trim()} onClick={() => void run(() => commentException(id, cmt.trim(), t("Me")), () => t("Comment added.")).then(() => setCmt(""))}>{t("Add comment")}</Button>
      </Card>
    </>
  );
}

function Raise() {
  const run = useDo();
  const [f, setF] = useState({ title: "", description: "", severity: "medium", type: "data_quality", category: "manual" });
  return (
    <Card title={t("Raise an exception")} sub={t("Record something that needs a person.")}>
      <Field label={t("Title")}><Input value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} /></Field>
      <Field label={t("What happened")}><Input value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></Field>
      <Field label={t("Severity")}><Select value={f.severity} onChange={(x) => setF({ ...f, severity: x.target.value })} options={SEVS.slice(1).map((s) => ({ value: s, label: sevLabel(s) }))} /></Field>
      <Button variant="primary" disabled={!f.title.trim() || !f.description.trim()} onClick={() => void run(() => raiseException(f), () => t("Exception raised.")).then(() => setF({ ...f, title: "", description: "" }))}>{t("Raise exception")}</Button>
    </Card>
  );
}

function Rules() {
  const fx = useFixture();
  const run = useDo();
  const [f, setF] = useState({ name: "", description: "", rule_type: "threshold", object_type: "", condition: "", severity: "medium" });
  const q = useQuery({ queryKey: ["v2", "exception-rules", fx], queryFn: getExceptionRules, retry: false });
  const rows = q.data?.rules ?? [];
  return (
    <>
      <Card title={t("Exception rules")} sub={t("When these match, an exception is raised for you.")}>
        {q.isLoading ? <Skeleton lines={4} label={t("Loading the rules")} /> : !rows.length ? <EmptyState heading={t("No exception rules yet")} /> : (
          <DataTable label={t("Exception rules")} rows={rows} rowKey={(r: ExceptionRule) => r.id}
            columns={[
              { key: "n", label: t("Rule"), render: (r) => <FieldChip code={r.id} description={r.name} />, sort: (r) => r.name },
              { key: "o", label: t("Object"), render: (r) => r.object_type ?? "" },
              { key: "s", label: t("Severity"), render: (r) => (r.severity ? sevLabel(r.severity) : ""), sort: (r) => r.severity ?? "" },
              { key: "a", label: t("On"), render: (r) => <input type="checkbox" aria-label={t("Switch {name}", { name: r.name })} checked={r.is_active} onChange={(x) => void run(() => setExceptionRuleActive(r.id, x.target.checked), () => t("Rule updated."))} /> },
            ]} />
        )}
      </Card>
      <Card title={t("Add an exception rule")}>
        <Field label={t("Name")}><Input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label={t("Description")}><Input value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></Field>
        <Field label={t("Object")}><Input value={f.object_type} onChange={(x) => setF({ ...f, object_type: x.target.value })} /></Field>
        <Field label={t("Condition")}><Input value={f.condition} onChange={(x) => setF({ ...f, condition: x.target.value })} /></Field>
        <Field label={t("Severity")}><Select value={f.severity} onChange={(x) => setF({ ...f, severity: x.target.value })} options={SEVS.slice(1).map((s) => ({ value: s, label: sevLabel(s) }))} /></Field>
        <Button variant="primary" disabled={!f.name.trim() || !f.condition.trim()} onClick={() => void run(() => createExceptionRule(f), () => t("Rule added.")).then(() => setF({ ...f, name: "", description: "", condition: "" }))}>{t("Add rule")}</Button>
      </Card>
    </>
  );
}

function Billing() {
  const fx = useFixture();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ["v2", "billing", fx, period], queryFn: () => getBilling(period), retry: false });
  const b = q.data;
  const tiers = b ? [[1, b.tier1_count, b.tier1_amount], [2, b.tier2_count, b.tier2_amount], [3, b.tier3_count, b.tier3_amount], [4, b.tier4_count, b.tier4_amount]] as const : [];
  return (
    <Card title={t("Exception billing")} sub={t("What this period costs, by tier.")}>
      <Field label={t("Period")}><Input type="month" value={period} onChange={(x) => setPeriod(x.target.value)} /></Field>
      {q.isLoading ? <Skeleton lines={4} label={t("Loading billing")} /> : q.isError || !b ? <EmptyState heading={t("No billing for this period")} /> : (
        <>
          <DataTable label={t("Billing by tier")} rows={tiers.map(([n, c, a]) => ({ id: String(n), n, c, a }))} rowKey={(r) => r.id}
            columns={[{ key: "n", label: t("Tier"), render: (r) => t("Tier {n}", { n: r.n }) }, { key: "c", label: t("Exceptions"), render: (r) => r.c, align: "end" }, { key: "a", label: t("Amount"), render: (r) => money(r.a, b.currency), align: "end" }]} />
          <dl className="mx-tiles"><StatTile label={t("Base fee")} value={money(b.base_fee, b.currency)} /><StatTile label={t("Total")} value={money(b.total_amount, b.currency)} /></dl>
        </>
      )}
    </Card>
  );
}

function Monitor() {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "sap-monitor", fx], queryFn: getSapMonitor, retry: false });
  const rows = q.data?.exceptions ?? [];
  return (
    <Card title={t("SAP monitor")} sub={t("Exceptions raised from the connected SAP system.")}>
      {q.isLoading ? <Skeleton lines={4} label={t("Loading the SAP monitor")} /> : !rows.length ? <EmptyState heading={t("Nothing from SAP right now")} /> : (
        <DataTable label={t("SAP monitor")} rows={rows} rowKey={(r: ExceptionRow) => r.id}
          columns={[{ key: "t", label: t("Title"), render: (r) => r.title }, { key: "c", label: t("Category"), render: (r) => r.category ?? "" }, { key: "s", label: t("Severity"), render: (r) => sevLabel(r.severity) }]} />
      )}
    </Card>
  );
}

/** Exceptions: list and detail, rules and billing tabs. */
export function Exceptions() {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const stacked = useStacked();
  const qc = useQueryClient();
  const run = useDo();
  const params = useSearchParams();
  const v = params.get("view");
  const [tab, setTab] = useState(v === "rules" || v === "billing" || v === "sap" ? v : "list");
  const [status, setStatus] = useState("");
  const [sev, setSev] = useState("");
  const [page, setPage] = useState(1);
  const [pick, setPick] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["v2", "exceptions", fx, status, sev, page], queryFn: () => getExceptions({ status, severity: sev, type: "", page }), retry: false });
  const met = useQuery({ queryKey: ["v2", "exception-metrics", fx], queryFn: getExceptionMetrics, retry: false });
  const rows = list.data?.exceptions ?? [];
  const m = met.data;

  useAletheiaScope({
    key: "exceptions", label: t("Asking about exceptions"), suggestions: [t("Which exceptions are overdue?")],
    answer: () => ({ text: t("{n} exceptions are overdue.", { n: m?.overdue_count ?? 0 }), evidence: rows.slice(0, 3).map((r) => r.title), actions: [] }),
  });

  const detail = pick ? <Detail id={pick} /> : <EmptyState heading={t("Pick an exception")} body={t("Its detail and actions show here.")} />;
  return (
    <>
      <PageHeader title={t("Exceptions")} context={t("Things that need a person to decide")}
        actions={<>
          <Button variant="secondary" onClick={() => void run(() => exportExceptions({}), (r) => t("Saved {name}.", { name: r.filename }))}>{t("Export sign-offs")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>} />
      {m ? (
        <dl className="mx-tiles">
          <StatTile label={t("Open")} value={m.open_count} />
          <StatTile label={t("Overdue")} value={m.overdue_count} />
          <StatTile label={t("Within SLA")} value={`${Math.round(m.sla_compliance_pct)}%`} />
          <StatTile label={t("Hours to resolve")} value={Math.round(m.avg_resolution_hours)} />
        </dl>
      ) : null}
      <Tabs idBase="mx-exc" label={t("Exception views")} value={tab} onChange={setTab}
        items={[{ id: "list", label: t("Exceptions") }, { id: "rules", label: t("Rules") }, { id: "billing", label: t("Billing") }, { id: "sap", label: t("SAP monitor") }]} />
      <div id={`mx-exc-panel-${tab}`} role="tabpanel" aria-labelledby={`mx-exc-tab-${tab}`}>
        {tab === "rules" ? <Rules /> : tab === "billing" ? <Billing /> : tab === "sap" ? <Monitor /> : (
          <div className="mx-split">
            <div className="mx-col">
              <div className="mx-chips" role="group" aria-label={t("Filter by status")}>
                <Chip selected={status === ""} onClick={() => { setStatus(""); setPage(1); }}>{t("All")}</Chip>
                {EXCEPTION_STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => { setStatus(s); setPage(1); }}>{STATUS_TEXT(s)}</Chip>)}
              </div>
              <Select aria-label={t("Severity")} value={sev} onChange={(x) => { setSev(x.target.value); setPage(1); }} options={SEVS.map((s) => ({ value: s, label: s ? sevLabel(s) : t("Any severity") }))} />
              <Card title={t("Exceptions")} sub={t("{n} in total", { n: list.data?.total ?? 0 })}>
                {list.isLoading ? <Skeleton lines={6} label={t("Loading exceptions")} /> : list.isError ? <ErrorState heading={t("Exceptions could not be loaded")} retryLabel={t("Try again")} onRetry={() => void list.refetch()} /> : !rows.length ? <EmptyState heading={t("No exceptions match")} /> : (
                  <DataTable label={t("Exceptions")} rows={rows} rowKey={(r: ExceptionRow) => r.id} selected={pick} onSelect={(r) => setPick(r.id)}
                    columns={[
                      { key: "t", label: t("Title"), render: (r) => r.title, sort: (r) => r.title },
                      { key: "y", label: t("Type"), render: (r) => <FieldChip code={r.type} description={r.category ?? undefined} /> },
                      { key: "s", label: t("Severity"), render: (r) => sevLabel(r.severity), sort: (r) => r.severity },
                      { key: "u", label: t("Status"), render: (r) => STATUS_TEXT(r.status), sort: (r) => r.status },
                      { key: "d", label: t("SLA"), render: (r) => day(r.sla_deadline ?? ""), sort: (r) => r.sla_deadline ?? "" },
                    ]} />
                )}
                <div className="mx-row">
                  <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Previous")}</Button>
                  <Button variant="ghost" disabled={(list.data?.total ?? 0) <= page * EXCEPTION_PAGE} onClick={() => setPage(page + 1)}>{t("Next")}</Button>
                </div>
              </Card>
              <Raise />
            </div>
            {stacked ? (
              <Sheet open={!!pick} onClose={() => { setPick(null); void qc.invalidateQueries({ queryKey: ["v2", "exceptions"] }); }} label={t("Exception")} closeLabel={t("Close")}>{detail}</Sheet>
            ) : <div className="mx-col">{detail}</div>}
          </div>
        )}
      </div>
    </>
  );
}
