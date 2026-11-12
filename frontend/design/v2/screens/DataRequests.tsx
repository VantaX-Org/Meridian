"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDataRequest, getDataRequest, getRequestFindings, listDataRequests, submitDataRequest,
  type ItemError, type RequestDetail, type RequestSummary,
} from "@/lib/api/v2/data-requests";
import { getAssignable } from "@/lib/api/v2/triage";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { StackedBar, type StackPart } from "../charts";
import { Field, Gate } from "../forms";
import { Consequence, ObjectRunChip } from "../FixParts";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";

/**
 * Data collection. A steward asks a business owner for the values a rule found missing or wrong. The owner fills one row
 * per record. Submitted values go to the cleaning queue as proposed corrections; a steward approves them there and the
 * normal apply path writes them. Nothing here changes data by itself.
 */

const statusText = (s: string): string =>
  s === "approved" ? t("Approved") : s === "submitted" ? t("Submitted") : s === "rejected" ? t("Rejected") : t("Open");

export function progressParts(r: RequestSummary): StackPart[] {
  return [
    { key: "approved", label: t("Approved"), value: r.approved, colour: "--m2-chart-3", title: t("{n} approved", { n: int(r.approved) }) },
    { key: "submitted", label: t("Submitted"), value: r.submitted, colour: "--m2-chart-1", title: t("{n} submitted, waiting for approval", { n: int(r.submitted) }) },
    { key: "open", label: t("Open"), value: r.open + r.rejected, colour: "--m2-sev-low", title: t("{n} still open", { n: int(r.open + r.rejected) }) },
  ];
}

function Progress({ r }: { r: RequestSummary }) {
  return <StackedBar parts={progressParts(r)} label={t("Progress of the request")} format={int} testId={`dr-progress-${r.id}`} />;
}

function OwnerForm({ id }: { id: string }) {
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["data-requests", fixture, "one", id], queryFn: () => getDataRequest(id) });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: (d: RequestDetail) =>
      submitDataRequest(id, d.items.filter((i) => (i.state === "open" || i.state === "rejected") && (vals[i.id] ?? "").trim()).map((i) => ({ item_id: i.id, value: vals[i.id] }))),
    onSuccess: (o) => {
      setErrs(Object.fromEntries(o.errors.map((e: ItemError) => [e.item_id, e.error])));
      toast.show(t("{n, plural, one {# value sent for approval} other {# values sent for approval}}", { n: o.submitted }));
      void qc.invalidateQueries({ queryKey: ["data-requests", fixture] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The values could not be sent.")), "error"),
  });
  if (q.isPending) return <Skeleton width="100%" height={160} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The request could not be read.")}</ErrorFrame>;
  const d = q.data;
  return (
    <form data-testid={`dr-form-${id}`} onSubmit={(e) => { e.preventDefault(); send.mutate(d); }}>
      <p className="m2-meta">{d.note}</p>
      <table className="m2-tbl">
        <thead><tr><th>{t("Record")}</th><th>{t("Field")}</th><th>{t("Current value")}</th><th>{t("New value")}</th><th>{t("State")}</th></tr></thead>
        <tbody>
          {d.items.map((i) => {
            const editable = i.state === "open" || i.state === "rejected";
            const list = i.allowed_values?.length ? `dr-list-${i.id}` : undefined;
            return (
              <tr key={i.id} data-testid={`dr-row-${i.id}`}>
                <td>{i.record_key}</td>
                <td><Coded code={i.field} text={i.field_label ?? undefined} /></td>
                <td>{i.current_value ?? t("Empty")}</td>
                <td>
                  {editable ? (
                    <>
                      <input
                        aria-label={t("New value for {field} of {record}", { field: i.field, record: i.record_key })}
                        value={vals[i.id] ?? ""} maxLength={i.max_length ?? undefined} list={list}
                        onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} data-testid={`dr-input-${i.id}`}
                      />
                      {list ? <datalist id={list}>{i.allowed_values?.map((a) => <option key={a.value} value={a.value}>{a.label ?? ""}</option>)}</datalist> : null}
                      {errs[i.id] ? <span role="alert" className="m2-meta" data-testid={`dr-error-${i.id}`}>{errs[i.id]}</span> : null}
                    </>
                  ) : i.new_value}
                </td>
                <td>{statusText(i.state)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Consequence>{t("Your values go to a steward as proposed corrections. Nothing changes in SAP until a steward approves them.")}</Consequence>
      <button type="submit" className="m2-btn m2-strong" disabled={send.isPending} data-testid={`dr-submit-${id}`}>{send.isPending ? t("Working…") : t("Send for approval")}</button>
    </form>
  );
}

function Mine() {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["data-requests", fixture, "mine"], queryFn: () => listDataRequests(true) });
  if (q.isPending) return <Skeleton width="100%" height={160} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("Your data requests could not be read.")}</ErrorFrame>;
  if (!q.data.length) return <EmptyFrame>{t("No one has asked you for data.")}</EmptyFrame>;
  return (
    <ul className="m2-cl-changes" data-testid="dr-mine">
      {q.data.map((r) => (
        <li key={r.id} data-testid={`dr-mine-${r.id}`}>
          <strong><ObjectRunChip module={r.module} /></strong>{" "}
          <span className="m2-meta">{t("{n} records, due {date}, {status}", { n: int(r.total), date: r.due_date, status: statusText(r.status) })}</span>
          <Progress r={r} />
          <button type="button" className="m2-btn" onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`dr-open-${r.id}`}>{open === r.id ? t("Close the form") : t("Fill in the form")}</button>
          {open === r.id ? <OwnerForm id={r.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [module, setModule] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const found = useQuery({ queryKey: ["data-requests", "findings", module], queryFn: () => getRequestFindings(module.trim()), enabled: module.trim().length > 0 });
  const users = useQuery({ queryKey: ["data-requests", "owners"], queryFn: getAssignable });
  const m = useMutation({
    mutationFn: () => createDataRequest({ module: module.trim(), check_ids: picked, owner_id: owner, due_date: due, note }),
    onSuccess: () => { toast.show(t("The request was sent.")); setPicked([]); setNote(""); onDone(); },
    onError: (e) => toast.show(errorSentence(e, t("The request could not be sent.")), "error"),
  });
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="m2-acts" role="group" aria-label={t("Ask an owner for data")} data-testid="dr-create">
      <Field label={t("Object")}>{(p) => <input {...p} value={module} onChange={(e) => { setModule(e.target.value); setPicked([]); }} data-testid="dr-module" />}</Field>
      {found.data ? (
        <fieldset data-testid="dr-findings">
          <legend>{t("Findings to ask about")}</legend>
          {found.data.findings.length === 0 ? <EmptyFrame>{t("This object has no findings with records.")}</EmptyFrame> : found.data.findings.map((f) => (
            <label key={f.check_id}>
              <input type="checkbox" checked={picked.includes(f.check_id)} onChange={() => toggle(f.check_id)} data-testid={`dr-pick-${f.check_id}`} />{" "}
              <Coded code={f.check_id} text={f.field_label ?? f.field} />{" "}
              <span className="m2-meta">{f.required_empty ? t("Required field is empty") : t("Wrong value")}, {t("{n} records", { n: int(f.failing) })}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field label={t("Owner")}>{(p) => (
        <select {...p} value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="dr-owner">
          <option value="">{t("Choose an owner")}</option>
          {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}</Field>
      <Field label={t("Due date")}>{(p) => <input {...p} type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="dr-due" />}</Field>
      <Field label={t("Note to the owner")}>{(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} data-testid="dr-note" />}</Field>
      <button type="button" className="m2-btn m2-strong" disabled={!picked.length || !owner || !due || m.isPending} onClick={() => m.mutate()} data-testid="dr-send">
        {m.isPending ? t("Working…") : t("Send the request")}
      </button>
      <Consequence>{t("The owner gets a form with one row per record. Nothing changes until a steward approves the values.")}</Consequence>
    </div>
  );
}

function Sent() {
  const fixture = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-requests", fixture, "all"], queryFn: () => listDataRequests(false) });
  return (
    <>
      <CreateForm onDone={() => void qc.invalidateQueries({ queryKey: ["data-requests", fixture] })} />
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The requests could not be read.")}</ErrorFrame> : !q.data.length ? <EmptyFrame>{t("You have sent no data requests yet.")}</EmptyFrame> : (
        <ul className="m2-cl-changes" data-testid="dr-sent">
          {q.data.map((r) => (
            <li key={r.id} data-testid={`dr-sent-${r.id}`}>
              <strong><ObjectRunChip module={r.module} /></strong>{" "}
              <span className="m2-meta">{t("{owner}, due {date}, {status}", { owner: r.owner_name ?? "", date: r.due_date, status: statusText(r.status) })}</span>
              <Progress r={r} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function DataRequests() {
  const { can } = useV2Session();
  const steward = can("assign");
  const fixture = useFixture();
  const mine = useQuery({ queryKey: ["data-requests", fixture, "mine"], queryFn: () => listDataRequests(true) });
  const waiting = (mine.data ?? []).filter((r) => r.status === "open").length;
  return (
    <CcPage title={t("Data requests")}>
      <CcBanner
        testId="data-requests"
        label={t("Data requests")}
        eyebrow={t("Data requests")}
        headline={t("{n, plural, one {# request waits for your values} other {# requests wait for your values}}", { n: waiting })}
        why={t("A steward asks the owner of the data for missing or wrong values. The owner fills a short form, and a steward approves the values before they apply.")}
        figs={[{ label: t("Waiting for you"), value: int(waiting) }, { label: t("Yours"), value: int((mine.data ?? []).length) }]}
      />
      <Panel title={t("My data requests")} meta={t("Fill in the values you were asked for.")} testId="dr-mine-panel"><Mine /></Panel>
      <Panel title={t("Requests sent")} meta={t("Ask an owner for data and follow the progress.")} testId="dr-sent-panel">
        {steward ? <Sent /> : <Gate>{t("Sending a data request needs the assign permission.")}</Gate>}
      </Panel>
    </CcPage>
  );
}
