"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDataRequest, getDataRequest, getRequestFindings, listDataRequests, submitDataRequest,
  type ItemError, type RequestDetail, type RequestItem, type RequestSummary,
} from "@/lib/api/v2/data-requests";
import { getAssignable } from "@/lib/api/v2/triage";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { DASH, int } from "@/lib/v2/score";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { currentRunFor } from "@/lib/v2/fix-run";
import { runLabel, runStatusWord } from "@/lib/v2/run-label";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton, useToast, type Column } from "../kit";
import { SegBar, type Seg } from "../kit/viz/SegBar";
import { Banner, Panel } from "./cfg-parts";

/**
 * Data collection. A steward asks a business owner for the values a rule found missing or wrong. The owner fills one row
 * per record. Submitted values go to the cleaning queue as proposed corrections; a steward approves them there and the
 * normal apply path writes them. Nothing here changes data by itself.
 */

const statusText = (s: string): string =>
  s === "approved" ? t("Approved") : s === "submitted" ? t("Submitted") : s === "rejected" ? t("Rejected") : t("Open");

export function progressSegs(r: RequestSummary): Seg[] {
  return [
    { key: "approved", label: t("Approved"), value: r.approved, tone: "good" },
    { key: "submitted", label: t("Submitted"), value: r.submitted, tone: "data" },
    { key: "open", label: t("Open"), value: r.open + r.rejected, tone: "warn" },
  ];
}

function Progress({ r }: { r: RequestSummary }) {
  return (
    <div aria-label={t("Progress of the request")}>
      <SegBar segs={progressSegs(r)} format={int} testid={`dr-progress-${r.id}`} />
    </div>
  );
}

const ObjectName = ({ module }: { module: string }) => <Code code={module} text={labelText(module)} />;

/** The object with the run it stands at now. Rows carry no run id, so no match shows a reason, never a guessed run. */
function ObjectRun({ module }: { module: string }) {
  const land = useLandscape(null);
  const cell = land.data?.cells.find((c) => c.module === module);
  const tl = useTimeline(cell?.system_id ?? null, 50);
  const hit = cell ? currentRunFor(land.data, tl.data?.runs, module, cell.system_id) : null;
  const system = cell ? land.data?.systems.find((x) => x.id === cell.system_id)?.name ?? null : null;
  const why = !cell
    ? land.isPending ? t("Reading the current run.") : t("This object has no scored run yet.")
    : tl.isPending ? t("Reading the current run.") : t("The run is not in the recent list.");
  return (
    <>
      <ObjectName module={module} />{" "}
      {hit ? (
        <Link href={`/run/${encodeURIComponent(hit.run.id)}`} className="nx-chip" data-testid="run-chip" title={formatDate(hit.run.run_at, "date")}>
          {runLabel(system, hit.run.run_number)} {runStatusWord(hit.run.status)}{hit.run.baseline ? ` ${t("Baseline")}` : ""}
        </Link>
      ) : <span className="nx-sub" title={why}>{DASH}</span>}
    </>
  );
}

function OwnerForm({ id }: { id: string }) {
  const fixture = useFixture();
  const qc = useQueryClient();
  const push = useToast();
  const q = useQuery({ queryKey: ["data-requests", fixture, "one", id], queryFn: () => getDataRequest(id) });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: (d: RequestDetail) =>
      submitDataRequest(id, d.items.filter((i) => (i.state === "open" || i.state === "rejected") && (vals[i.id] ?? "").trim()).map((i) => ({ item_id: i.id, value: vals[i.id] }))),
    onSuccess: (o) => {
      setErrs(Object.fromEntries(o.errors.map((e: ItemError) => [e.item_id, e.error])));
      push({ text: t("{n, plural, one {# value sent for approval} other {# values sent for approval}}", { n: o.submitted }), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["data-requests", fixture] });
    },
    onError: (e) => push({ text: errorSentence(e, t("The values could not be sent.")), tone: "bad" }),
  });
  if (q.isPending) return <Skeleton lines={4} label={t("The request could not be read.")} />;
  if (q.isError) return <ErrorState sentence={t("The request could not be read.")} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const cols: Column<RequestItem>[] = [
    { id: "record", label: t("Record"), cell: (i) => <span data-testid={`dr-row-${i.id}`}>{i.record_key}</span> },
    { id: "field", label: t("Field"), cell: (i) => <Code code={i.field} text={i.field_label ?? undefined} /> },
    { id: "current", label: t("Current value"), cell: (i) => i.current_value ?? t("Empty") },
    {
      id: "new",
      label: t("New value"),
      cell: (i) => {
        if (i.state !== "open" && i.state !== "rejected") return i.new_value;
        const list = i.allowed_values?.length ? `dr-list-${i.id}` : undefined;
        return (
          <>
            <input
              aria-label={t("New value for {field} of {record}", { field: i.field, record: i.record_key })}
              value={vals[i.id] ?? ""} maxLength={i.max_length ?? undefined} list={list}
              onChange={(e) => setVals({ ...vals, [i.id]: e.target.value })} data-testid={`dr-input-${i.id}`}
            />
            {list ? <datalist id={list}>{i.allowed_values?.map((a) => <option key={a.value} value={a.value}>{a.label ?? ""}</option>)}</datalist> : null}
            {errs[i.id] ? <span role="alert" className="nx-dr-err" data-testid={`dr-error-${i.id}`}>{errs[i.id]}</span> : null}
          </>
        );
      },
    },
    { id: "state", label: t("State"), cell: (i) => statusText(i.state) },
  ];
  return (
    <form className="nx-dr-form" data-testid={`dr-form-${id}`} onSubmit={(e) => { e.preventDefault(); send.mutate(d); }}>
      {d.note ? <p className="nx-sub">{d.note}</p> : null}
      <DataTable rows={d.items} columns={cols} rowKey={(i) => i.id} rowLabel={(i) => i.record_key} caption={t("Data requests")} />
      <p className="nx-sub">{t("Your values go to a steward as proposed corrections. Nothing changes in SAP until a steward approves them.")}</p>
      <Button type="submit" variant="primary" loading={send.isPending} data-testid={`dr-submit-${id}`}>{t("Send for approval")}</Button>
    </form>
  );
}

function Mine() {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["data-requests", fixture, "mine"], queryFn: () => listDataRequests(true) });
  if (q.isPending) return <Skeleton lines={3} label={t("My data requests")} />;
  if (q.isError) return <ErrorState sentence={t("Your data requests could not be read.")} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState heading={t("No one has asked you for data.")} />;
  return (
    <ul className="nx-dr-list" data-testid="dr-mine">
      {q.data.map((r) => (
        <li key={r.id} className="nx-dr-item" data-testid={`dr-mine-${r.id}`}>
          <div>
            <strong><ObjectRun module={r.module} /></strong>{" "}
            <span className="nx-sub">{t("{n} records, due {date}, {status}", { n: int(r.total), date: r.due_date, status: statusText(r.status) })}</span>
          </div>
          <Progress r={r} />
          <div>
            <Button variant="secondary" size={32} onClick={() => setOpen(open === r.id ? null : r.id)} data-testid={`dr-open-${r.id}`}>
              {open === r.id ? t("Close the form") : t("Fill in the form")}
            </Button>
          </div>
          {open === r.id ? <OwnerForm id={r.id} /> : null}
        </li>
      ))}
    </ul>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const push = useToast();
  const [objectKey, setObjectKey] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const found = useQuery({ queryKey: ["data-requests", "findings", objectKey], queryFn: () => getRequestFindings(objectKey.trim()), enabled: objectKey.trim().length > 0 });
  const users = useQuery({ queryKey: ["data-requests", "owners"], queryFn: getAssignable });
  const m = useMutation({
    mutationFn: () => createDataRequest({ module: objectKey.trim(), check_ids: picked, owner_id: owner, due_date: due, note }),
    onSuccess: () => { push({ text: t("The request was sent."), tone: "good" }); setPicked([]); setNote(""); onDone(); },
    onError: (e) => push({ text: errorSentence(e, t("The request could not be sent.")), tone: "bad" }),
  });
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="nx-dr-form nx-dr-list" role="group" aria-label={t("Ask an owner for data")} data-testid="dr-create">
      <label>{t("Object")}<input value={objectKey} onChange={(e) => { setObjectKey(e.target.value); setPicked([]); }} data-testid="dr-module" /></label>
      {found.data ? (
        <fieldset className="nx-card nx-dr-picks" data-testid="dr-findings">
          <legend>{t("Findings to ask about")}</legend>
          {found.data.findings.length === 0 ? <p className="nx-sub">{t("This object has no findings with records.")}</p> : found.data.findings.map((f) => (
            <label key={f.check_id}>
              <input type="checkbox" checked={picked.includes(f.check_id)} onChange={() => toggle(f.check_id)} data-testid={`dr-pick-${f.check_id}`} />
              <Code code={f.check_id} text={f.field_label ?? f.field} />
              <span className="nx-sub">{f.required_empty ? t("Required field is empty") : t("Wrong value")}, {t("{n} records", { n: int(f.failing) })}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label>{t("Owner")}
        <select value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="dr-owner">
          <option value="">{t("Choose an owner")}</option>
          {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label>{t("Due date")}<input type="date" value={due} onChange={(e) => setDue(e.target.value)} data-testid="dr-due" /></label>
      <label>{t("Note to the owner")}<input value={note} onChange={(e) => setNote(e.target.value)} data-testid="dr-note" /></label>
      <div>
        <Button variant="primary" disabled={!picked.length || !owner || !due} loading={m.isPending} onClick={() => m.mutate()} data-testid="dr-send">{t("Send the request")}</Button>
      </div>
      <p className="nx-sub">{t("The owner gets a form with one row per record. Nothing changes until a steward approves the values.")}</p>
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
      {q.isPending ? <Skeleton lines={3} label={t("Requests sent")} /> : q.isError ? <ErrorState sentence={t("The requests could not be read.")} onRetry={() => void q.refetch()} /> : !q.data.length ? <EmptyState heading={t("You have sent no data requests yet.")} /> : (
        <ul className="nx-dr-list" data-testid="dr-sent">
          {q.data.map((r) => (
            <li key={r.id} className="nx-dr-item" data-testid={`dr-sent-${r.id}`}>
              <div>
                <strong><ObjectRun module={r.module} /></strong>{" "}
                <span className="nx-sub">{t("{owner}, due {date}, {status}", { owner: r.owner_name ?? "", date: r.due_date, status: statusText(r.status) })}</span>
              </div>
              <Progress r={r} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function DataRequests() {
  const session = useV2Session();
  const live = !session.shared && !session.viewAs;
  const steward = session.can("assign") && live;
  const fixture = useFixture();
  const mine = useQuery({ queryKey: ["data-requests", fixture, "mine"], queryFn: () => listDataRequests(true) });
  const waiting = (mine.data ?? []).filter((r) => r.status === "open").length;
  return (
    <div className="nx-stack" data-testid="data-requests-page">
      <Banner
        testId="data-requests"
        label={t("Data requests")}
        meta={t("Data requests")}
        title={t("{n, plural, one {# request waits for your values} other {# requests wait for your values}}", { n: waiting })}
        why={t("A steward asks the owner of the data for missing or wrong values. The owner fills a short form, and a steward approves the values before they apply.")}
        figs={[{ label: t("Waiting for you"), value: int(waiting) }, { label: t("Yours"), value: int((mine.data ?? []).length) }]}
      />
      <Panel title={t("My data requests")} meta={t("Fill in the values you were asked for.")} testId="dr-mine-panel"><Mine /></Panel>
      <Panel title={t("Requests sent")} meta={t("Ask an owner for data and follow the progress.")} testId="dr-sent-panel">
        {steward ? <Sent /> : <p className="nx-sub">{t("Sending a data request needs the assign permission.")}</p>}
      </Panel>
    </div>
  );
}
