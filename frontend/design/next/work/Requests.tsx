"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rejectRequest } from "@/lib/api/next/approvals";
import { approveWriteback, getPendingWritebacks, type PendingWriteback } from "@/lib/api/v2/batches";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import type { ForecastRow } from "@/lib/api/v2/process-analytics";
import {
  createRequest,
  deleteCriticalField,
  deleteDefault,
  deleteDerivation,
  putCriticalField,
  putDefault,
  putDerivation,
  submitRequest,
  validateRequest,
  type ChangeRequest,
  type CriticalField,
  type Derivation,
  type EntryDefault,
  type MassRow,
  type Precheck,
  type RequestKind,
  type RequestObject,
  type RequestStatus,
  type RequestView,
} from "@/lib/api/v2/requests";
import { formatDate, labelOf } from "@/lib/format";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { refreshV2 } from "@/lib/v2/queries";
import { useApprovalForecast, useCriticalFields, useDerivations, useEntryDefaults, useMassPreview, useRequests } from "@/lib/v2/requests-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int, pct1 } from "@/lib/v2/score";
import { ageWord, kindWord, objectWord, statusWord } from "@/design/v2/inspector/request";
import { parseFields, parseKeys } from "@/design/v2/screens/Requests";
import { Button, Code, Confirm, DataTable, EmptyState, ErrorState, PartBar, SegmentedControl, Skeleton, useToast, type Column } from "../kit";
import { Banner, Consequence, FixHead, FlowSteps } from "./parts";
import "./queue.css";

const VIEWS: RequestView[] = ["mine", "to_approve", "all"];
const OBJECTS: RequestObject[] = ["material", "customer", "vendor", "business_partner"];
const KINDS: RequestKind[] = ["create", "change", "mass_change"];
const STATUSES: RequestStatus[] = ["draft", "submitted", "in_approval", "approved", "rejected", "creating", "created", "failed", "cancelled"];
const viewWord = (v: RequestView) => (v === "mine" ? t("Mine") : v === "to_approve" ? t("To approve") : t("All"));
const fieldCode = (f: string) => <Code code={f} text={describeField(f) ?? undefined} />;

/** One toast for a failed action, worded from the API answer. */
function useFail() {
  const toast = useToast();
  return (e: unknown, fallback: string) => toast({ text: errorSentence(e, fallback), tone: "bad" });
}

/**
 * The change requests of the Work journey, natively: the list by view and filter with the forecast of the waiting
 * step, a New request form that checks before it submits, the stage and workload charts, the entry defaults,
 * derivation rules and critical fields, and the write-backs that wait for a second approver.
 */
export function WorkRequests() {
  const { can, shared } = useV2Session();
  const { openItem } = useOpenItem();
  const [view, setView] = useUrlParam<RequestView>("view", "mine", VIEWS);
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const [object, setObject] = useUrlParam<string>("object", "all");
  const [kind, setKind] = useUrlParam<string>("kind", "all");
  const [keysParam] = useUrlParam<string>("keys", "");
  const [composing, setComposing] = useState(keysParam !== "");
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const q = useRequests({ view, status: status === "all" ? undefined : status, object: object === "all" ? undefined : object, kind: kind === "all" ? undefined : kind });
  const rows = q.data?.items ?? [];
  const canWrite = can("mdm.write") && !shared;
  const canManage = can("manage_workflows") && !shared;
  const waiting = rows.filter((r) => r.status === "submitted" || r.status === "in_approval").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const overdue = rows.filter((r) => r.overdue).length;

  return (
    <div className="nx-wq" data-testid="requests-canvas">
      <h1 className="nx-wq-h">{t("Requests")}</h1>
      <p className="nx-wq-meta">{t("Create and change master data with approval")}</p>
      <Banner
        testId="requests-banner"
        label={t("Requests")}
        eyebrow={t("Change requests")}
        headline={waiting > 0 ? t("{n} {waiting, plural, one {request waits} other {requests wait}} for approval", { n: int(waiting), waiting }) : t("No request waits for approval")}
        why={
          overdue > 0
            ? t("{n} {overdue, plural, one {request is} other {requests are}} past the due time of the waiting approval step.", { n: int(overdue), overdue })
            : failed > 0
              ? t("{n} {failed, plural, one {request} other {requests}} failed to reach SAP and need a new look.", { n: int(failed), failed })
              : t("Nothing has failed in this list.")
        }
        figs={[
          { label: t("Waiting"), value: int(waiting), note: t("submitted or in approval") },
          { label: t("Overdue"), value: int(overdue), note: t("past the step due time") },
          { label: t("Failed"), value: int(failed), note: t("did not reach SAP") },
          { label: t("Drafts"), value: int(drafts), note: t("not yet submitted") },
        ]}
        action={
          <>
            <Button variant="primary" aria-expanded={composing} disabled={!canWrite} data-testid="requests-primary" onClick={() => setComposing((c) => !c)}>{t("New request")}</Button>
            {canWrite ? <Link className="nx-wq-link" href="/requests/new">{t("Use the form")}</Link> : <span className="nx-wq-meta">{t("A new request needs the master data write permission")}</span>}
          </>
        }
      />
      <FixHead
        lede={t("This page lists requests to create or change master data. Each goes through approval before it reaches SAP. A request belongs to a record, not to a scoring run, so rows carry no run. Start with New request, or open one that waits for you.")}
        means={[
          [t("Waiting"), t("Requests submitted or in approval.")],
          [t("Overdue"), t("Waiting requests past the due time of the current approval step.")],
          [t("Failed"), t("Requests approved that did not reach SAP.")],
          [t("Drafts"), t("Requests saved but not yet submitted.")],
        ]}
      />
      <FlowSteps
        label={t("Request steps")}
        current={failed > 0 ? 3 : waiting > 0 ? 2 : drafts > 0 ? 1 : 0}
        steps={[
          { label: t("Start a request"), hint: t("Choose New request and fill in the record.") },
          { label: t("Submit it"), count: int(drafts), hint: t("A saved draft does nothing until you submit it.") },
          { label: t("Approvers decide"), count: int(waiting), hint: t("Each approval step has a due time.") },
          { label: t("It reaches SAP"), count: int(failed), hint: t("The count shows requests that did not reach SAP.") },
        ]}
      />
      {composing && canWrite ? (
        <NewRequest
          initialKeys={keysParam}
          onDone={(id) => {
            setComposing(false);
            openItem({ kind: "request", id });
          }}
        />
      ) : null}
      <WritebackApprovals />
      <SegmentedControl label={t("Requests views")} items={VIEWS.map((v) => ({ value: v, label: viewWord(v) }))} value={view} onChange={(v) => setView(v as RequestView)} />
      <div className="nx-wq-bar">
        <label>
          {t("Status")}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{t("Any status")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{statusWord(s)}</option>)}
          </select>
        </label>
        <label>
          {t("Object")}
          <select value={object} onChange={(e) => setObject(e.target.value)}>
            <option value="all">{t("Any object")}</option>
            {OBJECTS.map((o) => <option key={o} value={o}>{objectWord(o)}</option>)}
          </select>
        </label>
        <label>
          {t("Kind")}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("Any kind")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{kindWord(k)}</option>)}
          </select>
        </label>
      </div>
      <RequestsTable
        rows={rows}
        waiting={waiting > 0}
        loading={q.isPending}
        error={q.isError ? { sentence: t("The change requests could not be read. Check that the API is reachable, then retry."), onRetry: () => void q.refetch() } : undefined}
        emptyText={view === "to_approve" ? t("No request waits for your approval.") : t("No change request matches. Start one with New request.")}
      />
      <Consequence>{t("Submitting sends the request for approval. Nothing reaches SAP until every approval step is done.")}</Consequence>
      {rows.length ? <Charts rows={rows} /> : null}
      <div className="nx-wq-row">
        <Button variant="secondary" aria-expanded={defaultsOpen} onClick={() => setDefaultsOpen((o) => !o)}>{t("Entry defaults")}</Button>
        <Button variant="secondary" aria-expanded={rulesOpen} onClick={() => setRulesOpen((o) => !o)}>{t("Derivations and critical fields")}</Button>
      </div>
      {defaultsOpen ? <EntryDefaults canEdit={canManage} /> : null}
      {rulesOpen ? (
        <>
          <DerivationRules canEdit={canManage} />
          <CriticalFields canEdit={canManage} />
        </>
      ) : null}
    </div>
  );
}

function requestTitle(r: ChangeRequest): string {
  if (r.title) return r.title;
  if (r.kind === "mass_change" && r.record_count) return t("Mass change of {n} {count, plural, one {record} other {records}}", { n: int(r.record_count), count: r.record_count });
  return r.object_key ?? t("Untitled request");
}

function RequestsTable({ rows, waiting, loading, error, emptyText }: { rows: ChangeRequest[]; waiting: boolean; loading: boolean; error?: { sentence: string; onRetry: () => void }; emptyText: string }) {
  const { hrefFor } = useOpenItem();
  const fc = useApprovalForecast(waiting);
  const byId = new Map((fc.data?.requests ?? []).map((f) => [f.request_id, f]));
  const columns: Column<ChangeRequest>[] = [
    { id: "request", label: t("Request"), cell: (r) => <a className="nx-wq-link" href={hrefFor({ kind: "request", id: r.id })}>{requestTitle(r)}</a>, compare: (a, b) => requestTitle(a).localeCompare(requestTitle(b)) },
    { id: "object", label: t("Object"), cell: (r) => objectWord(r.object) },
    { id: "kind", label: t("Kind"), cell: (r) => kindWord(r.kind) },
    { id: "status", label: t("Status"), cell: (r) => statusWord(r.status, r.entry_released_at) },
    { id: "requester", label: t("Requester"), cell: (r) => r.requester_label ?? "" },
    { id: "updated", label: t("Updated"), cell: (r) => (r.updated_at ? formatDate(r.updated_at, "date") : ""), compare: (a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? "") },
    { id: "age", label: t("Age"), cell: (r) => (r.age_hours == null ? "" : ageWord(r.age_hours)), align: "end", compare: (a, b) => (a.age_hours ?? 0) - (b.age_hours ?? 0) },
    { id: "due", label: t("Due"), cell: (r) => (r.due_at ? <span className="nx-wq-cell">{formatDate(r.due_at, "date")}{r.overdue ? <strong>{t("Overdue")}</strong> : null}</span> : "") },
    { id: "forecast", label: t("Forecast"), cell: (r) => <ForecastCell f={byId.get(r.id)} /> },
  ];
  return (
    <div data-testid="requests-table">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowLabel={requestTitle}
        caption={t("Change requests")}
        loading={loading}
        error={error}
        empty={{ heading: emptyText }}
      />
    </div>
  );
}

/** ETA of the waiting step and the chance it misses its SLA, from how long the same step took on decided requests. */
function ForecastCell({ f }: { f: ForecastRow | undefined }) {
  if (!f) return null;
  if (f.eta == null) return <small>{t("No history")}</small>;
  const p = f.breach_probability;
  const risk = p != null && p >= 0.5;
  return (
    <span className="nx-wq-cell" data-testid={`forecast-${f.request_id}`} title={t("{step}: from {n, plural, one {# decided task} other {# decided tasks}}", { step: f.step, n: f.n })}>
      {formatDate(f.eta, "date")}
      {f.breached ? <strong>{t("SLA missed")}</strong> : p == null ? null : risk ? <strong>{t("{p} breach risk", { p: pct1(p) })}</strong> : <small>{t("{p} breach risk", { p: pct1(p) })}</small>}
    </span>
  );
}

function Charts({ rows }: { rows: ChangeRequest[] }) {
  const people = new Map<string, number>();
  for (const r of rows) if (r.requester_label) people.set(r.requester_label, (people.get(r.requester_label) ?? 0) + 1);
  const top = [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="nx-wq-stats">
      <section className="nx-wq-card" data-testid="requests-pipeline">
        <h2 className="nx-wq-h">{t("Requests by stage")}</h2>
        <PartBar
          label={t("Requests by stage, from draft to SAP")}
          segments={STATUSES.map((s) => ({ label: statusWord(s), value: rows.filter((r) => r.status === s).length })).filter((s) => s.value > 0)}
          format={(n) => int(n)}
        />
      </section>
      {top.length ? (
        <section className="nx-wq-card" data-testid="requests-workload">
          <h2 className="nx-wq-h">{t("Requests per person")}</h2>
          <dl className="nx-wq-dl">
            {top.map(([who, n]) => (
              <div key={who} style={{ display: "contents" }}>
                <dt>{who}</dt>
                <dd>{t("{n} {count, plural, one {request} other {requests}}", { n: int(n), count: n })}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function NewRequest({ onDone, initialKeys }: { onDone: (id: string) => void; initialKeys: string }) {
  const qc = useQueryClient();
  const fail = useFail();
  const [object, setObject] = useState<RequestObject>("material");
  const [kind, setKind] = useState<RequestKind>(initialKeys ? "mass_change" : "create");
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState("");
  const [keys, setKeys] = useState(initialKeys.replace(/[,;]/g, "\n"));
  const [massField, setMassField] = useState("");
  const [massValue, setMassValue] = useState("");
  const [draft, setDraft] = useState<ChangeRequest | null>(null);
  const [check, setCheck] = useState<Precheck | null>(null);
  const [busy, setBusy] = useState(false);
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDraft(null);
    setCheck(null);
  };
  const mass = kind === "mass_change";
  const mf = massField.trim().toUpperCase();
  const payload: Record<string, string> = mass ? (mf && massValue.trim() ? { [mf]: massValue.trim() } : {}) : parseFields(fields);
  const recordKeys = parseKeys(keys, object);
  const empty = Object.keys(payload).length === 0 || (kind === "change" && !key.trim()) || (mass && recordKeys.length === 0);

  const runCheck = async () => {
    setBusy(true);
    try {
      const d = draft ?? (await createRequest({ kind, object, object_key: kind === "change" ? key.trim() : null, title: title.trim() || null, payload, ...(mass ? { record_keys: recordKeys } : {}) }));
      setDraft(d);
      setCheck(await validateRequest(d.id));
      await qc.invalidateQueries({ queryKey: ["v2"] });
    } catch (e) {
      fail(e, t("The request could not be checked."));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await submitRequest(draft.id);
      await qc.invalidateQueries({ queryKey: ["v2"] });
      onDone(draft.id);
    } catch (e) {
      fail(e, t("The request could not be submitted."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nx-wq-card" data-testid="new-request" aria-label={t("New request")}>
      <div className="nx-wq-form">
        <label>
          {t("Object")}
          <select value={object} onChange={(e) => edit(setObject)(e.target.value as RequestObject)}>
            {OBJECTS.map((o) => <option key={o} value={o}>{objectWord(o)}</option>)}
          </select>
        </label>
        <label>
          {t("Kind")}
          <select value={kind} onChange={(e) => edit(setKind)(e.target.value as RequestKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{kindWord(k)}</option>)}
          </select>
        </label>
        {kind === "change" ? (
          <label>
            {t("SAP key of the record to change")}
            <input value={key} onChange={(e) => edit(setKey)(e.target.value)} />
          </label>
        ) : null}
        <label>
          {t("Title")}
          <input value={title} maxLength={200} onChange={(e) => edit(setTitle)(e.target.value)} />
        </label>
        {mass ? (
          <>
            <label>
              {t("Record keys, one per line; a bare number takes the key field of the object")}
              <textarea value={keys} placeholder="MATNR=000000000000000101" onChange={(e) => edit(setKeys)(e.target.value)} />
            </label>
            <label>
              {t("Field, as TABLE.FIELD")}
              <input value={massField} maxLength={60} placeholder="MARC.DISPO" onChange={(e) => edit(setMassField)(e.target.value)} />
              {mf && describeField(mf) ? <small>{describeField(mf)}</small> : null}
            </label>
            <label>
              {t("New value")}
              <input value={massValue} maxLength={500} onChange={(e) => edit(setMassValue)(e.target.value)} />
            </label>
            <p className="nx-wq-meta">{t("Meridian shows each record's current value from its own data. Nothing is written to SAP; an approved mass change leaves a load file.")}</p>
          </>
        ) : (
          <label>
            {t("Fields, one TABLE.FIELD=value per line")}
            <textarea value={fields} placeholder="MARA.MATKL=001" onChange={(e) => edit(setFields)(e.target.value)} />
          </label>
        )}
      </div>
      <div className="nx-wq-row">
        <Button variant="secondary" loading={busy} disabled={busy || empty} onClick={() => void runCheck()}>{t("Check")}</Button>
        <Button variant="primary" disabled={busy || !check || check.problems.length > 0} onClick={() => void submit()}>{t("Submit for approval")}</Button>
      </div>
      {check ? <PrecheckView p={check} /> : null}
      {mass && draft ? <MassPreview id={draft.id} /> : null}
    </section>
  );
}

/** The rule pre-checks and duplicate candidates of a request: what the validate step answered. */
export function PrecheckView({ p }: { p: Precheck }) {
  const { hrefFor } = useOpenItem();
  const clean = p.problems.length === 0 && p.failures.length === 0 && p.duplicates.length === 0;
  return (
    <div className="nx-wq-form" data-testid="precheck">
      <p>
        {clean
          ? t("{rules} rules ran; none failed and no duplicate was found.", { rules: int(p.rules_run) })
          : t("{rules} rules ran: {failures} failed, {duplicates} possible duplicates.", { rules: int(p.rules_run), failures: int(p.failures.length), duplicates: int(p.duplicates.length) })}
      </p>
      {p.problems.length ? <ul data-testid="precheck-problems">{p.problems.map((x) => <li key={x}>{x}</li>)}</ul> : null}
      {p.failures.length ? (
        <ul data-testid="precheck-failures">
          {p.failures.map((f, i) => (
            <li key={`${f.check_id}-${i}`} className="nx-wq-row">
              <a className="nx-wq-link" href={hrefFor({ kind: "rule", id: f.check_id })}>{f.check_id}</a>
              <span>{labelOf(f.severity)}</span>
              {f.field ? fieldCode(f.field) : null}
              <span>{f.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.duplicates.length ? (
        <ul data-testid="precheck-duplicates">
          {p.duplicates.map((d) => (
            <li key={d.master_record_id} className="nx-wq-row">
              <a className="nx-wq-link" href={hrefFor({ kind: "golden", id: d.master_record_id })}>{d.sap_object_key ?? d.master_record_id}</a>
              <span>{t("{score}% alike", { score: Math.round(d.score * 100) })}</span>
              <small>{d.attributes.map((a) => `${a.field}: ${a.value ?? "—"}`).join(", ")}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MassPreview({ id }: { id: string }) {
  const q = useMassPreview(id);
  if (q.isPending) return <Skeleton lines={3} />;
  if (q.isError) return <ErrorState sentence={t("The preview could not be read.")} onRetry={() => void q.refetch()} />;
  const { counts, rows, truncated } = q.data;
  const columns: Column<MassRow>[] = [
    { id: "record", label: t("Record"), cell: (r) => <Code code={r.record_key} text={r.known ? (r.text ?? undefined) : t("Not found")} /> },
    { id: "field", label: t("Field"), cell: (r) => fieldCode(r.field) },
    { id: "before", label: t("Current value"), cell: (r) => r.before ?? "" },
    { id: "after", label: t("New value"), cell: (r) => r.after },
  ];
  return (
    <div className="nx-wq-form" data-testid="mass-preview">
      <p>
        {t("{records} {n, plural, one {record} other {records}}: {found} found, {missing} not found, {changing} would change, {unchanged} already hold the value.", {
          records: int(counts.records),
          n: counts.records,
          found: int(counts.found),
          missing: int(counts.missing),
          changing: int(counts.changing),
          unchanged: int(counts.unchanged),
        })}
      </p>
      <DataTable rows={rows} columns={columns} rowKey={(r) => `${r.record_key}-${r.field}`} rowLabel={(r) => r.record_key} caption={t("Preview of the mass change")} />
      {truncated ? <p className="nx-wq-meta">{t("Only the first rows are shown.")}</p> : null}
    </div>
  );
}

/** A section of request settings with its read, error and empty states. */
function Settings<R>({ testid, title, note, q, columns, rowKey, rowLabel, errorText, emptyText, children }: {
  testid: string; title: string; note: string; q: { isPending: boolean; isError: boolean; data?: { items: R[] }; refetch: () => unknown };
  columns: Column<R>[]; rowKey: (r: R) => string; rowLabel: (r: R) => string; errorText: string; emptyText: string; children?: ReactNode;
}) {
  return (
    <section className="nx-wq-card" data-testid={testid} aria-label={title}>
      <h2 className="nx-wq-h">{title}</h2>
      <p className="nx-wq-meta">{note}</p>
      {q.isPending ? (
        <Skeleton lines={3} />
      ) : q.isError ? (
        <ErrorState sentence={errorText} onRetry={() => void q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState heading={emptyText} />
      ) : (
        <DataTable rows={q.data.items} columns={columns} rowKey={rowKey} rowLabel={rowLabel} caption={title} />
      )}
      {children}
    </section>
  );
}

function EntryDefaults({ canEdit }: { canEdit: boolean }) {
  const q = useEntryDefaults();
  const qc = useQueryClient();
  const fail = useFail();
  const [object, setObject] = useState<RequestObject>("material");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [drop, setDrop] = useState<EntryDefault | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["v2", "request-defaults"] });
  const columns: Column<EntryDefault>[] = [
    { id: "object", label: t("Object"), cell: (d) => objectWord(d.object as RequestObject) },
    { id: "field", label: t("Field"), cell: (d) => fieldCode(d.field) },
    { id: "value", label: t("Value"), cell: (d) => d.value },
    ...(canEdit ? [{ id: "remove", label: t("Remove"), cell: (d: EntryDefault) => <Button variant="quiet" onClick={() => setDrop(d)}>{t("Remove")}</Button> }] : []),
  ];
  const save = async () => {
    setBusy(true);
    try {
      await putDefault(object, field.trim().toUpperCase(), value);
      await refresh();
      setField("");
      setValue("");
    } catch (e) {
      fail(e, t("The default could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Settings
      testid="entry-defaults"
      title={t("Entry defaults")}
      note={t("A new create request gets these values in the fields its requester leaves empty. A change request is never defaulted.")}
      q={q}
      columns={columns}
      rowKey={(d) => d.id}
      rowLabel={(d) => d.field}
      errorText={t("The entry defaults could not be read.")}
      emptyText={t("No entry default is set.")}
    >
      {canEdit ? (
        <div className="nx-wq-bar">
          <label>
            {t("Object")}
            <select value={object} onChange={(e) => setObject(e.target.value as RequestObject)}>
              {OBJECTS.map((o) => <option key={o} value={o}>{objectWord(o)}</option>)}
            </select>
          </label>
          <label>
            {t("Field, as TABLE.FIELD")}
            <input value={field} maxLength={60} onChange={(e) => setField(e.target.value)} />
          </label>
          <label>
            {t("Value")}
            <input value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} />
          </label>
          <Button variant="primary" loading={busy} disabled={busy || !field.trim() || !value.trim()} onClick={() => void save()}>{t("Save default")}</Button>
        </div>
      ) : null}
      <Confirm
        open={drop !== null}
        title={t("Remove")}
        consequence={drop ? t("The default {value} for {field} of {object} is removed. New create requests keep that field empty when the requester leaves it empty.", { value: drop.value, field: describeField(drop.field) ?? drop.field, object: objectWord(drop.object as RequestObject) }) : ""}
        confirmLabel={t("Remove")}
        danger
        onCancel={() => setDrop(null)}
        onConfirm={async () => {
          const d = drop;
          setDrop(null);
          if (!d) return;
          try {
            await deleteDefault(d.id);
            await refresh();
          } catch (e) {
            fail(e, t("The default could not be removed."));
          }
        }}
      />
    </Settings>
  );
}

function DerivationRules({ canEdit }: { canEdit: boolean }) {
  const q = useDerivations();
  const qc = useQueryClient();
  const fail = useFail();
  const [object, setObject] = useState<RequestObject>("material");
  const [when, setWhen] = useState("");
  const [values, setValues] = useState("");
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"value" | "copy">("value");
  const [source, setSource] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [drop, setDrop] = useState<Derivation | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["v2", "request-derivations"] });
  const list = values.split(",").map((v) => v.trim()).filter(Boolean);
  const ready = when.trim() && list.length && target.trim() && (mode === "copy" ? source.trim() : value.trim());
  const src = source.trim().toUpperCase();
  const columns: Column<Derivation>[] = [
    { id: "object", label: t("Object"), cell: (d) => objectWord(d.object as RequestObject) },
    { id: "when", label: t("When field"), cell: (d) => fieldCode(d.when_field) },
    { id: "values", label: t("Is one of"), cell: (d) => d.when_values.join(", ") },
    { id: "target", label: t("Set field"), cell: (d) => fieldCode(d.target_field) },
    { id: "to", label: t("Set to"), cell: (d) => (d.source_field ? <span className="nx-wq-row">{t("Copy of")} {fieldCode(d.source_field)}</span> : (d.value ?? "")) },
    ...(canEdit ? [{ id: "remove", label: t("Remove"), cell: (d: Derivation) => <Button variant="quiet" onClick={() => setDrop(d)}>{t("Remove")}</Button> }] : []),
  ];
  const save = async () => {
    setBusy(true);
    try {
      await putDerivation(object, when.trim().toUpperCase(), list, target.trim().toUpperCase(), mode === "copy" ? { source_field: src } : { value: value.trim() });
      await refresh();
      setWhen("");
      setValues("");
      setTarget("");
      setSource("");
      setValue("");
    } catch (e) {
      fail(e, t("The rule could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Settings
      testid="derivation-rules"
      title={t("Derivations and critical fields")}
      note={t("When a field of a request holds one of the listed values, another field of the same request is set to a fixed value or to a copy of a third field. A copy from an empty field is skipped. A derived value is marked as derived in the history of the request.")}
      q={q}
      columns={columns}
      rowKey={(d) => d.id}
      rowLabel={(d) => d.target_field}
      errorText={t("The derivation rules could not be read.")}
      emptyText={t("No derivation rule is set.")}
    >
      {canEdit ? (
        <div className="nx-wq-bar">
          <label>
            {t("Object")}
            <select value={object} onChange={(e) => setObject(e.target.value as RequestObject)}>
              {OBJECTS.map((o) => <option key={o} value={o}>{objectWord(o)}</option>)}
            </select>
          </label>
          <label>
            {t("When field, as TABLE.FIELD")}
            <input value={when} maxLength={60} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label>
            {t("Is one of, separated by commas")}
            <input value={values} maxLength={500} onChange={(e) => setValues(e.target.value)} />
          </label>
          <label>
            {t("Set field, as TABLE.FIELD")}
            <input value={target} maxLength={60} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label>
            {t("Set to")}
            <select value={mode} onChange={(e) => setMode(e.target.value as "value" | "copy")}>
              <option value="value">{t("Constant value")}</option>
              <option value="copy">{t("Copy from field")}</option>
            </select>
          </label>
          {mode === "copy" ? (
            <label>
              {t("Source field, as TABLE.FIELD")}
              <input value={source} maxLength={60} onChange={(e) => setSource(e.target.value)} />
              {src && describeField(src) ? <small>{describeField(src)}</small> : null}
            </label>
          ) : (
            <label>
              {t("To value")}
              <input value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          <Button variant="primary" loading={busy} disabled={busy || !ready} onClick={() => void save()}>{t("Save rule")}</Button>
        </div>
      ) : null}
      <Confirm
        open={drop !== null}
        title={t("Remove")}
        consequence={drop ? t("The rule that sets {field} of {object} is removed. Requests saved from now on no longer get that value from it.", { field: describeField(drop.target_field) ?? drop.target_field, object: objectWord(drop.object as RequestObject) }) : ""}
        confirmLabel={t("Remove")}
        danger
        onCancel={() => setDrop(null)}
        onConfirm={async () => {
          const d = drop;
          setDrop(null);
          if (!d) return;
          try {
            await deleteDerivation(d.id);
            await refresh();
          } catch (e) {
            fail(e, t("The rule could not be removed."));
          }
        }}
      />
    </Settings>
  );
}

function CriticalFields({ canEdit }: { canEdit: boolean }) {
  const q = useCriticalFields();
  const qc = useQueryClient();
  const fail = useFail();
  const [object, setObject] = useState<RequestObject>("material");
  const [field, setField] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["v2", "request-critical-fields"] });
  const remove = async (c: CriticalField) => {
    try {
      await deleteCriticalField(c.id);
      await refresh();
    } catch (e) {
      fail(e, t("The critical field could not be removed."));
    }
  };
  const columns: Column<CriticalField>[] = [
    { id: "object", label: t("Object"), cell: (c) => objectWord(c.object as RequestObject) },
    { id: "field", label: t("Field"), cell: (c) => fieldCode(c.field) },
    ...(canEdit ? [{ id: "remove", label: t("Remove"), cell: (c: CriticalField) => <Button variant="quiet" onClick={() => void remove(c)}>{t("Remove")}</Button> }] : []),
  ];
  const save = async () => {
    setBusy(true);
    try {
      await putCriticalField(object, field.trim().toUpperCase());
      await refresh();
      setField("");
    } catch (e) {
      fail(e, t("The critical field could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Settings
      testid="critical-fields"
      title={t("Critical fields")}
      note={t("A request that touches one of these fields is flagged critical and needs a critical field approval step after the usual steps.")}
      q={q}
      columns={columns}
      rowKey={(c) => c.id}
      rowLabel={(c) => c.field}
      errorText={t("The critical fields could not be read.")}
      emptyText={t("No critical field is set.")}
    >
      {canEdit ? (
        <div className="nx-wq-bar">
          <label>
            {t("Object")}
            <select value={object} onChange={(e) => setObject(e.target.value as RequestObject)}>
              {OBJECTS.map((o) => <option key={o} value={o}>{objectWord(o)}</option>)}
            </select>
          </label>
          <label>
            {t("Field, as TABLE.FIELD")}
            <input value={field} maxLength={60} onChange={(e) => setField(e.target.value)} />
          </label>
          <Button variant="primary" loading={busy} disabled={busy || !field.trim()} onClick={() => void save()}>{t("Save critical field")}</Button>
        </div>
      ) : null}
    </Settings>
  );
}

/** Write-backs that wait for a second approver. Four eyes: the requester never approves or rejects their own. */
function WritebackApprovals() {
  const { can, id: me } = useV2Session();
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const allowed = can("approve");
  const q = useQuery({ queryKey: ["v2", "writeback-approvals", fx], queryFn: getPendingWritebacks, enabled: allowed, retry: false });
  const [approve, setApprove] = useState<PendingWriteback | null>(null);
  const [reject, setReject] = useState<PendingWriteback | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;
  if (q.isError) return <ErrorState sentence={t("The write-backs waiting for a second approver could not be loaded.")} onRetry={() => void q.refetch()} />;
  const list = q.data?.approvals ?? [];
  if (!list.length) return null;
  const columns: Column<PendingWriteback>[] = [
    { id: "rule", label: t("Rule"), cell: (w) => (w.check_id ? <Code code={w.check_id} text={w.rule_message ?? undefined} /> : (w.rule_message ?? "")) },
    { id: "by", label: t("Requested by"), cell: (w) => w.requested_by_name ?? w.requested_by ?? "" },
    { id: "records", label: t("Records"), cell: (w) => int(w.records_updated), align: "end" },
    {
      id: "action",
      label: t("Action"),
      cell: (w) =>
        w.requested_by === me ? (
          <small>{t("You asked for this write-back. A second person must approve it.")}</small>
        ) : (
          <span className="nx-wq-row">
            <Button variant="primary" disabled={busy} onClick={() => setApprove(w)}>{t("Approve write-back")}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setReject(w); setReason(""); }}>{t("Reject")}</Button>
          </span>
        ),
    },
  ];
  const doReject = async () => {
    if (!reject) return;
    setBusy(true);
    try {
      await rejectRequest(reject.id, reason.trim());
      await refreshV2(qc);
      setReject(null);
      toast({ text: t("Write-back rejected. The requester has been told."), tone: "good" });
    } catch (e) {
      fail(e, t("The write-back could not be rejected."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="nx-wq-card" data-testid="writeback-approvals" aria-label={t("Write-back waiting for a second approver")}>
      <h2 className="nx-wq-h">{t("Write-back waiting for a second approver")}</h2>
      {q.data && !q.data.live_enabled ? <p className="nx-wq-meta">{t("Live write-back is off on this deployment, so approving writes nothing. Deliver the fixes with the export.")}</p> : null}
      <DataTable rows={list} columns={columns} rowKey={(w) => w.id} rowLabel={(w) => w.check_id ?? w.id} caption={t("Write-back waiting for a second approver")} />
      {reject ? (
        <form className="nx-wq-bar" aria-label={t("Reject write-back")} onSubmit={(e) => { e.preventDefault(); void doReject(); }}>
          <label>
            {t("Reason")}
            <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button variant="primary" type="submit" loading={busy} disabled={busy || !reason.trim()}>{t("Reject write-back")}</Button>
          <Button variant="quiet" type="button" onClick={() => setReject(null)}>{t("Cancel")}</Button>
        </form>
      ) : null}
      <Link className="nx-wq-link" href="/work">{t("Open the work queue")}</Link>
      <Confirm
        open={approve !== null}
        title={t("Approve write-back")}
        consequence={approve ? t("Approving writes {n} {count, plural, one {record} other {records}} to SAP. This cannot be undone.", { n: int(approve.records_updated), count: approve.records_updated }) : ""}
        confirmLabel={t("Write to SAP")}
        danger
        onCancel={() => setApprove(null)}
        onConfirm={async () => {
          const w = approve;
          setApprove(null);
          if (!w) return;
          setBusy(true);
          try {
            const r = await approveWriteback(w.id);
            await refreshV2(qc);
            if (r.errors.length) toast({ text: r.errors[0], tone: "bad" });
            else toast({ text: t("Write-back approved. {n} {count, plural, one {record} other {records}} written to SAP.", { n: int(r.applied), count: r.applied }), tone: "good" });
          } catch (e) {
            fail(e, t("The write-back could not be approved."));
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
