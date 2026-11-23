"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { postApproveBatch, postSendBack } from "@/lib/api/v2/work";
import { approveWriteback, cancelBatchRun, checkBatchWriteback, getBatchRun, getPendingWritebacks, OPEN_RUN, reassignBatch, resumeBatchRun, retryFailedBatchRun, sendBatchWriteback, type BatchWritebackCheck, type PendingWriteback, type WritebackRun } from "@/lib/api/v2/batches";
import { approveBlock, BATCH_STATUS_LABEL, sentLine, trailOf, type BatchRow } from "@/lib/v2/batches";
import { useAssignable, useBatchEvents, useBatches } from "@/lib/v2/approvals-queries";
import { whole } from "@/lib/v2/format";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Sheet, Skeleton, StatTile, Tabs, useAletheia, useAletheiaScope, useStacked } from "@/ui/kit";
import { ObjChip } from "./ObjChip";
import { day, useDo } from "./shared";
import { displayKey } from "@/lib/v2/work";

function Trail({ id }: { id: string }) {
  const q = useBatchEvents(id);
  if (q.isLoading) return <Skeleton lines={3} label={t("Loading the trail")} />;
  const steps = trailOf(q.data?.items ?? []);
  if (!steps.length) return <EmptyState heading={t("No steps yet")} />;
  return (
    <ul className="mx-list">
      {steps.map((s) => (
        <li key={s.key}>
          <strong>{s.word}</strong> {s.user ?? ""} {day(s.at)}{s.records > 1 ? ` (${whole(s.records)})` : ""}{s.note ? `: ${s.note}` : ""}
        </li>
      ))}
    </ul>
  );
}

export function BatchDetail({ b }: { b: BatchRow }) {
  const run = useDo();
  const people = useAssignable(true);
  const [note, setNote] = useState("");
  const [who, setWho] = useState("");
  const [ask, setAsk] = useState<"approve" | "back" | null>(null);
  const block = approveBlock(b, { approve: true }, null);
  return (
    <>
      <Card title={`${b.label} ${b.name}`} sub={BATCH_STATUS_LABEL[b.status]}>
        <p className="mx-muted">{t("{n} records, built by {who}", { n: whole(b.records), who: b.owner ?? "" })}</p>
        <div className="mx-chips">{b.modules.map((m) => <ObjChip key={m} code={m} />)}</div>
        {b.returned ? <p>{t("Sent back by {who}: {note}", { who: b.returned.by ?? "", note: b.returned.note ?? "" })}</p> : null}
        {b.status === "exported" ? <p>{sentLine(b, day)}</p> : null}
        {b.verification ? <p>{t("After the load: {a} fixed, {b} still failing", { a: whole(b.verification.fixed), b: whole(b.verification.stillFailing) })}</p> : null}
        {block ? <p className="mx-muted">{block}</p> : null}
        <div className="mx-row">
          <Button variant="primary" disabled={b.status !== "draft"} onClick={() => setAsk("approve")}>{t("Approve")}</Button>
          <Button variant="secondary" disabled={b.status !== "draft"} onClick={() => setAsk("back")}>{t("Send back")}</Button>
        </div>
        <Field label={t("Hand over to")}>
          <Select value={who} onChange={(e) => setWho(e.target.value)} options={[{ value: "", label: t("Pick a person") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        </Field>
        <Button variant="ghost" disabled={!who} onClick={() => void run(() => reassignBatch(b.id, who), () => t("The batch is handed over."))}>{t("Hand over")}</Button>
      </Card>
      <Card title={t("Trail")}><Trail id={b.id} /></Card>
      <Confirm open={ask === "approve"} title={t("Approve this batch?")} confirmLabel={t("Approve")} cancelLabel={t("Cancel")} onCancel={() => setAsk(null)}
        onConfirm={() => { setAsk(null); void run(() => postApproveBatch(b.id, false), () => t("The batch is approved.")); }}>
        {t("{n} records go to the approved list.", { n: whole(b.records) })}
      </Confirm>
      <Confirm open={ask === "back"} title={t("Send this batch back?")} confirmLabel={t("Send back")} cancelLabel={t("Cancel")} danger onCancel={() => setAsk(null)}
        onConfirm={() => { if (!note.trim()) return; setAsk(null); void run(() => postSendBack(b.id, note.trim()), () => t("The batch is sent back.")); setNote(""); }}>
        <Field label={t("Reason")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {note.trim() ? null : <p className="mx-muted" role="status">{t("A reason is required.")}</p>}
      </Confirm>
    </>
  );
}

function Batches() {
  const stacked = useStacked();
  const q = useBatches();
  // ?batch= picks a batch on arrival, by id or by its B- label, so links from People and Home land on it.
  const [pick, setPick] = useState<string | null>(useSearchParams().get("batch"));
  const sel = q.rows.find((r) => r.id === pick || r.label === pick) ?? null;
  const detail = sel ? <BatchDetail b={sel} /> : <EmptyState heading={t("Pick a batch")} body={t("Its records and trail show here.")} />;
  return (
    <div className="mx-split">
      <div className="mx-col">
        <Card title={t("Remediation batches")} sub={t("{n} batches", { n: q.rows.length })}>
          {q.isLoading ? <Skeleton lines={5} label={t("Loading batches")} /> : q.isError ? <ErrorState heading={t("Batches could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : !q.rows.length ? <EmptyState heading={t("No batches yet")} /> : (
            <DataTable label={t("Batches")} rows={q.rows} rowKey={(r: BatchRow) => r.id} selected={sel?.id ?? null} onSelect={(r) => setPick(r.id)}
              columns={[
                { key: "b", label: t("Batch"), render: (r) => `${r.label} ${r.name}`, sort: (r) => r.label },
                { key: "s", label: t("Status"), render: (r) => BATCH_STATUS_LABEL[r.status], sort: (r) => r.status },
                { key: "o", label: t("Objects"), render: (r) => <span className="mx-chips">{r.modules.map((m) => <ObjChip key={m} code={m} />)}</span> },
                { key: "n", label: t("Records"), render: (r) => whole(r.records), sort: (r) => r.records, align: "end" },
                { key: "u", label: t("Built by"), render: (r) => r.owner ?? "", sort: (r) => r.owner ?? "" },
                { key: "d", label: t("Due"), render: (r) => day(r.dueAt), sort: (r) => r.dueAt ?? "" },
              ]} />
          )}
        </Card>
      </div>
      {stacked ? <Sheet open={!!sel} onClose={() => setPick(null)} label={t("Batch")} closeLabel={t("Close")}>{detail}</Sheet> : <div className="mx-col">{detail}</div>}
    </div>
  );
}

function RunPanel({ id }: { id: string }) {
  const fx = useFixture();
  const run = useDo();
  const q = useQuery({ queryKey: ["v2", "batch-run", fx, id], queryFn: () => getBatchRun(id), retry: false });
  const r: WritebackRun | undefined = q.data;
  if (q.isLoading) return <Skeleton lines={2} label={t("Loading the run")} />;
  if (!r) return <p className="mx-muted">{t("No send has run for this batch.")}</p>;
  const open = OPEN_RUN.includes(r.status);
  return (
    <>
      <dl className="mx-tiles">
        <StatTile label={t("Sent")} value={whole(r.counts.committed)} />
        <StatTile label={t("Failed")} value={whole(r.counts.failed)} />
        <StatTile label={t("Waiting")} value={whole(r.counts.pending)} />
        <StatTile label={t("Needs a check")} value={whole(r.counts.needs_check)} />
      </dl>
      {r.pause_reason ? <p>{r.pause_reason}</p> : null}
      {r.errors.map((e) => <p key={e} className="mx-muted">{e}</p>)}
      <div className="mx-row">
        <Button variant="secondary" disabled={!open} onClick={() => void run(() => resumeBatchRun(id), () => t("The run resumes."))}>{t("Resume")}</Button>
        <Button variant="secondary" disabled={!open} onClick={() => void run(() => cancelBatchRun(id), () => t("The run is cancelled."))}>{t("Cancel run")}</Button>
        <Button variant="secondary" disabled={open || r.counts.failed === 0} onClick={() => void run(() => retryFailedBatchRun(id), () => t("Failed records go again."))}>{t("Retry failed")}</Button>
      </div>
    </>
  );
}

function SendDetail({ b, live }: { b: BatchRow; live: boolean }) {
  const run = useDo();
  const [chk, setChk] = useState<BatchWritebackCheck | null>(null);
  return (
    <Card title={`${b.label} ${b.name}`} sub={t("{n} records", { n: whole(b.records) })}>
      {!live ? <p className="mx-muted">{t("Live write-back is off. The batch goes out as an export for the SAP load.")}</p> : null}
      <div className="mx-row">
        <Button variant="secondary" onClick={() => void run(() => checkBatchWriteback(b.id), (x) => t("Check done, {n} records can be sent.", { n: whole(x.bapi) })).then((x) => setChk(x))}>{t("Check with SAP")}</Button>
        <Button variant="primary" disabled={!live || b.status !== "approved"} onClick={() => void run(() => sendBatchWriteback(b.id), () => t("The send has started."))}>{t("Send to SAP")}</Button>
      </div>
      {chk ? (
        <DataTable label={t("Fields in this batch")} rows={chk.fields} rowKey={(f) => `${f.record_key}-${f.field}`} height={240}
          columns={[
            { key: "r", label: t("Record"), render: (f) => displayKey(f.record_key) },
            { key: "f", label: t("Field"), render: (f) => <FieldChip code={f.field} description={f.reason ?? undefined} /> },
            { key: "d", label: t("Goes by"), render: (f) => f.delivery },
          ]} />
      ) : null}
      {chk?.errors.map((e) => <p key={e} className="mx-muted">{e}</p>)}
      <RunPanel id={b.id} />
    </Card>
  );
}

function Send() {
  const fx = useFixture();
  const run = useDo();
  const stacked = useStacked();
  const wb = useQuery({ queryKey: ["v2", "writeback-approvals", fx], queryFn: getPendingWritebacks, retry: false });
  const bq = useBatches();
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const live = wb.data?.live_enabled ?? false;
  const ready = bq.rows.filter((b) => b.status === "approved" || b.status === "awaiting_load" || b.status === "exported");
  const sel = ready.find((r) => r.id === pick) ?? null;
  const detail = sel ? <SendDetail b={sel} live={live} /> : <EmptyState heading={t("Pick a batch")} body={t("Check it with SAP, then send it.")} />;
  const pending = wb.data?.approvals ?? [];
  return (
    <div className="mx-split">
      <div className="mx-col">
        <Card title={t("Waiting for a second person")} sub={t("{n} write-backs", { n: pending.length })}>
          {wb.isLoading ? <Skeleton lines={3} label={t("Loading approvals")} /> : wb.isError ? <ErrorState heading={t("Approvals could not be loaded")} retryLabel={t("Try again")} onRetry={() => void wb.refetch()} /> : !pending.length ? <EmptyState heading={t("Nothing waits for approval")} /> : (
            <DataTable label={t("Write-back approvals")} rows={pending} rowKey={(p: PendingWriteback) => p.id}
              columns={[
                { key: "m", label: t("Object"), render: (p) => (p.module ? <ObjChip code={p.module} /> : "") },
                { key: "c", label: t("Rule"), render: (p) => (p.check_id ? <FieldChip code={p.check_id} description={p.rule_message ?? undefined} /> : "") },
                { key: "n", label: t("Records"), render: (p) => whole(p.records_updated), align: "end" },
                { key: "u", label: t("Asked by"), render: (p) => p.requested_by_name ?? "" },
                { key: "a", label: t("Approve"), render: (p) => <Button variant="secondary" disabled={busy === p.id} onClick={() => { setBusy(p.id); void run(() => approveWriteback(p.id), (x) => t("{n} records are written.", { n: whole(x.applied) })).finally(() => setBusy(null)); }}>{t("Approve")}</Button> },
              ]} />
          )}
        </Card>
        <Card title={t("Approved batches")} sub={t("{n} batches", { n: ready.length })}>
          {!ready.length ? <EmptyState heading={t("No approved batches")} /> : (
            <DataTable label={t("Approved batches")} rows={ready} rowKey={(r: BatchRow) => r.id} selected={sel?.id ?? null} onSelect={(r) => setPick(r.id)}
              columns={[
                { key: "b", label: t("Batch"), render: (r) => `${r.label} ${r.name}`, sort: (r) => r.label },
                { key: "s", label: t("Status"), render: (r) => BATCH_STATUS_LABEL[r.status], sort: (r) => r.status },
                { key: "n", label: t("Records"), render: (r) => whole(r.records), sort: (r) => r.records, align: "end" },
              ]} />
          )}
        </Card>
      </div>
      {stacked ? <Sheet open={!!sel} onClose={() => setPick(null)} label={t("Send to SAP")} closeLabel={t("Close")}>{detail}</Sheet> : <div className="mx-col">{detail}</div>}
    </div>
  );
}

/** Approvals: remediation batches to approve or send back, and the write-back to SAP. */
export function Approvals() {
  useInterfaceLang();
  const chat = useAletheia();
  const bq = useBatches();
  const [tab, setTab] = useState("batches");
  useAletheiaScope({
    key: "approvals", label: t("Asking about approvals"), suggestions: [t("Which batches wait for approval?")],
    answer: () => {
      const w = bq.rows.filter((b) => b.status === "draft");
      return { text: t("{n} batches wait for approval.", { n: w.length }), evidence: w.slice(0, 3).map((b) => `${b.label} ${b.name}`), actions: [] };
    },
  });
  return (
    <>
      <PageHeader title={t("Approvals")} context={t("Four eyes before anything reaches SAP")}
        actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>} />
      <Tabs idBase="mx-apr" label={t("Approval views")} value={tab} onChange={setTab}
        items={[{ id: "batches", label: t("Batches") }, { id: "send", label: t("Send to SAP") }]} />
      <div id={`mx-apr-panel-${tab}`} role="tabpanel" aria-labelledby={`mx-apr-tab-${tab}`}>{tab === "batches" ? <Batches /> : <Send />}</div>
    </>
  );
}
