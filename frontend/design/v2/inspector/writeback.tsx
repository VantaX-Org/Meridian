"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OPEN_RUN, cancelBatchRun, checkBatchWriteback, getBatchRun, getBatchRunRecords, resumeBatchRun, retryFailedBatchRun, sendBatchWriteback, type BatchWritebackCheck, type RunRecord, type RunStatus, type WritebackField, type WritebackRun } from "@/lib/api/v2/batches";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import type { BatchRow } from "@/lib/v2/batches";
import type { BatchCan } from "@/lib/v2/batch-actions";
import { refreshV2 } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Grid, type GridColumn } from "../Grid";
import { Fact } from "../Inspector";
import { Confirm, StatusWord } from "../admin/kit";
import { ConfirmBar } from "../forms";
import { describeField } from "@/lib/v2/sap-fields";
import { Coded, Dash, Mono } from "../parts";
import { ResultFrame, type Outcome } from "./shared";

const PAGE = 25;

const FIELD_COLUMNS = (): GridColumn<WritebackField>[] => [
  { id: "record", header: tr("Record"), width: 190, pin: true, cell: (f) => <Mono>{f.record_key}</Mono> },
  { id: "field", header: tr("Field"), width: 220, cell: (f) => <Coded code={f.field} text={describeField(f.field)} /> },
  { id: "delivery", header: tr("Goes by"), width: 90, cell: (f) => (f.delivery === "bapi" ? <StatusWord tone="go">{tr("BAPI")}</StatusWord> : <StatusWord tone="at-risk">{tr("Export")}</StatusWord>) },
  { id: "bapi", header: tr("BAPI"), width: 200, cell: (f) => (f.bapi ? <Mono>{f.bapi}</Mono> : <Dash why={tr("No BAPI carries this field yet")} />) },
  { id: "reason", header: tr("Reason"), width: 320, cell: (f) => f.reason ?? tr("A BAPI carries it") },
];

const STATE_WORD = (st: RunRecord["state"]) =>
  st === "failed" ? <StatusWord tone="no-go">{tr("Refused by SAP")}</StatusWord> : st === "needs_check" ? <StatusWord tone="at-risk">{tr("To check in SAP")}</StatusWord> : <StatusWord tone="neutral">{st}</StatusWord>;

/** SAP's error message of a record, else the last RETURN message, else the reason the worker stored. */
const sapMessage = (r: RunRecord) => r.messages.find((m) => m.type === "E" || m.type === "A") ?? r.messages[r.messages.length - 1] ?? null;

const FAILURE_COLUMNS = (): GridColumn<RunRecord>[] => [
  { id: "record", header: tr("Record"), width: 260, pin: true, cell: (r) => <Coded code={r.record_key} text={r.description} /> },
  { id: "state", header: tr("Result"), width: 140, cell: (r) => STATE_WORD(r.state) },
  { id: "msg", header: tr("SAP message"), width: 420, cell: (r) => { const m = sapMessage(r); return m ? <Coded code={`${m.id} ${m.number}`.trim()} text={m.message} /> : r.error || <Dash why={tr("SAP was not reached for this record")} />; } },
  { id: "why", header: tr("Reason"), width: 300, cell: (r) => r.error || <Dash why={tr("No reason stored")} /> },
];

const RUN_WORD = (st: RunStatus) => {
  switch (st) {
    case "completed":
      return <StatusWord tone="go">{tr("Sent")}</StatusWord>;
    case "completed_with_errors":
      return <StatusWord tone="at-risk">{tr("Sent with refusals")}</StatusWord>;
    case "paused":
      return <StatusWord tone="no-go">{tr("Paused")}</StatusWord>;
    case "cancelled":
      return <StatusWord tone="at-risk">{tr("Cancelled")}</StatusWord>;
    case "cancelling":
      return <StatusWord tone="neutral">{tr("Cancelling")}</StatusWord>;
    case "running":
      return <StatusWord tone="neutral">{tr("Sending")}</StatusWord>;
    default:
      return <StatusWord tone="neutral">{tr("Waiting for a worker")}</StatusWord>;
  }
};

/** The progress of a run: counts, why it paused, what failed, and the actions that fit its state. */
function RunPanel({ b, run, can, mine, busy, act }: { b: BatchRow; run: WritebackRun; can: BatchCan; mine: boolean; busy: boolean; act: (what: "resume" | "cancel" | "retry" | "retry-checked") => void }) {
  const [offset, setOffset] = useState(0);
  const [asking, setAsking] = useState(false);
  const failColumns = useMemo(() => FAILURE_COLUMNS(), []);
  const fixture = useFixture();
  const c = run.counts;
  const done = run.records - c.pending - c.sending;
  const trouble = c.failed + c.needs_check;
  const open = OPEN_RUN.includes(run.status);
  const page = useQuery({
    queryKey: ["v2", "wb-run-records", fixture, b.id, run.id, c.failed, c.needs_check, offset],
    queryFn: () => getBatchRunRecords(b.id, undefined, PAGE, offset),
    enabled: trouble > 0,
    retry: false,
  });
  const total = page.data?.total ?? 0;
  const can2 = can.approve && !mine;
  return (
    <div data-testid="writeback-run">
      <p className="m2-prov" data-testid="writeback-summary">
        {tr("Sent {sent} of {records}, refused {failed}, to check {check}, waiting {pending}.", { sent: int(c.committed), records: int(run.records), failed: int(c.failed), check: int(c.needs_check), pending: int(c.pending + c.sending) })}
      </p>
      <progress value={done} max={Math.max(run.records, 1)} aria-label={tr("Records handled by the write-back")} data-testid="writeback-progress" />
      <dl className="m2-facts">
        <Fact label={tr("Run status")}>{RUN_WORD(run.status)}</Fact>
        <Fact label={tr("Records")}>{int(run.records)}</Fact>
        <Fact label={tr("Committed")}>{int(c.committed)}</Fact>
        <Fact label={tr("Failed")}>{int(c.failed)}</Fact>
        <Fact label={tr("To check in SAP")}>{int(c.needs_check)}</Fact>
        <Fact label={tr("Pending")}>{int(c.pending + c.sending)}</Fact>
        <Fact label={tr("Fields for export only")}>{int(run.export_only_fields)}</Fact>
      </dl>
      {run.status === "paused" && run.pause_reason ? (
        <p className="m2-prov" role="status" data-testid="writeback-pause">
          {tr("Paused: {reason}", { reason: run.pause_reason })}
        </p>
      ) : null}
      {run.stale && open ? <p className="m2-prov" role="status">{tr("No worker has reported on this run for a while. Resume it to continue; a record that was in flight is marked to check in SAP and is not sent again.")}</p> : null}
      {c.needs_check > 0 ? <p className="m2-prov">{tr("A record to check in SAP may or may not have been committed. Look it up in SAP before you send it again.")}</p> : null}
      {run.errors.map((e) => (
        <p key={e} className="m2-prov">
          {e}
        </p>
      ))}
      {can.approve ? (
        <div className="m2-acts">
          {(run.status === "paused" || (run.stale && open)) && can2 ? (
            <button type="button" className="m2-btn m2-strong" disabled={busy} onClick={() => act("resume")}>
              {tr("Resume")}
            </button>
          ) : null}
          {open && run.status !== "cancelling" ? (
            <button type="button" className="m2-btn" disabled={busy} onClick={() => setAsking(true)}>
              {tr("Cancel run")}
            </button>
          ) : null}
          {!open && c.failed > 0 && can2 ? (
            <button type="button" className="m2-btn" disabled={busy} onClick={() => act("retry")}>
              {tr("Retry failed")}
            </button>
          ) : null}
          {!open && c.needs_check > 0 && can2 ? (
            <button type="button" className="m2-btn" disabled={busy} onClick={() => act("retry-checked")}>
              {tr("Checked in SAP, send again")}
            </button>
          ) : null}
        </div>
      ) : null}
      {asking && open ? (
        <ConfirmBar
          message={tr("The write-back of batch {label} stops. Records SAP has already committed stay committed; the records still waiting are not sent.", { label: b.label })}
          confirmLabel={tr("Cancel run")}
          pending={busy}
          onConfirm={() => {
            setAsking(false);
            act("cancel");
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      {trouble > 0 ? (
        <>
          <Grid<RunRecord> id="writeback-failures" ariaLabel={tr("Records SAP refused or that need a check")} columns={failColumns} rows={page.data?.items ?? []} rowId={(r) => r.record_key} compact height={320} primary={false} fixedColumns hideBar />
          {total > PAGE ? (
            <div className="m2-acts">
              <button type="button" className="m2-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                {tr("Previous page")}
              </button>
              <span className="m2-prov">{tr("{from} to {to} of {total}", { from: int(offset + 1), to: int(Math.min(offset + PAGE, total)), total: int(total) })}</span>
              <button type="button" className="m2-btn" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                {tr("Next page")}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Live write-back of an approved batch, shown only when the deployment writes to SAP itself (GET /settings
 * `live_writeback`). Step 1, Check with SAP: which fields a BAPI carries and why the others go out with the export;
 * nothing is sent. Step 2, Send to SAP: for an approver who did not build the batch, after a confirmation with the
 * record count. The send queues a run; a worker writes it in chunks and the panel follows it until it ends.
 */
export function LiveWriteback({ b, can }: { b: BatchRow; can: BatchCan }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const [check, setCheck] = useState<BatchWritebackCheck | null>(null);
  const [busy, setBusy] = useState<"check" | "send" | "act" | null>(null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<Outcome | null>(null);
  const mine = b.ownerId != null && b.ownerId === can.me;
  const fieldColumns = useMemo(FIELD_COLUMNS, []);
  const runKey = ["v2", "wb-run", fixture, b.id] as const;
  const runQ = useQuery({
    queryKey: runKey,
    queryFn: () => getBatchRun(b.id),
    retry: false,
    refetchInterval: (q) => (q.state.data && OPEN_RUN.includes(q.state.data.status) ? (fixture ? 1000 : 3000) : false),
  });
  const run = runQ.data ?? null;
  const open = run != null && OPEN_RUN.includes(run.status);
  // The batch turns Sent to SAP while the worker runs; the shell follows when the run ends.
  const ended = run != null && !open ? run.status : null;
  useEffect(() => {
    if (ended) void refreshV2(qc);
  }, [ended, qc]);

  const runCheck = async () => {
    setBusy("check");
    setFailure(null);
    try {
      setCheck(await checkBatchWriteback(b.id));
    } catch (e) {
      setFailure({ tone: "fail", title: tr("The check with SAP did not go through"), detail: errorSentence(e, tr("SAP could not be checked.")) });
    } finally {
      setBusy(null);
    }
  };
  const runSend = async () => {
    setAsking(false);
    setBusy("send");
    setFailure(null);
    try {
      qc.setQueryData(runKey, await sendBatchWriteback(b.id));
    } catch (e) {
      setFailure({ tone: "fail", title: tr("The batch was not sent to SAP"), detail: errorSentence(e, tr("The batch could not be sent to SAP.")) });
    } finally {
      setBusy(null);
    }
  };
  const runAct = async (what: "resume" | "cancel" | "retry" | "retry-checked") => {
    setBusy("act");
    setFailure(null);
    try {
      qc.setQueryData(runKey, await (what === "resume" ? resumeBatchRun(b.id) : what === "cancel" ? cancelBatchRun(b.id) : retryFailedBatchRun(b.id, what === "retry-checked")));
    } catch (e) {
      setFailure({ tone: "fail", title: tr("The run was not changed"), detail: errorSentence(e, tr("The run could not be changed.")) });
    } finally {
      setBusy(null);
    }
  };

  if (b.status !== "approved" && !run) return null;
  const canSend = b.status === "approved" && !open;
  const sendBlock = !can.approve ? tr("Sending to SAP needs the approve permission, which your role does not hold.") : mine ? tr("You built this batch; a second person sends it.") : !check ? tr("Check with SAP first.") : check.bapi === 0 ? tr("No field of this batch goes by BAPI; deliver it with the load file.") : null;

  return (
    <section aria-label={tr("Live write-back")} data-testid="live-writeback">
      <h3>{tr("Live write-back")}</h3>
      <p className="m2-prov">{tr("This deployment writes approved values to SAP through its BAPIs. Check with SAP first: it says which fields a BAPI carries and why the others go out with the load file. Nothing is sent by the check.")}</p>
      <div className="m2-acts">
        {canSend && (can.apply || can.approve) ? (
          <button type="button" className="m2-btn" disabled={busy !== null} onClick={() => void runCheck()}>
            {busy === "check" ? tr("Checking…") : check ? tr("Check again") : tr("Check with SAP")}
          </button>
        ) : null}
        {canSend && can.approve ? (
          <button type="button" className="m2-btn m2-strong" disabled={busy !== null || sendBlock !== null} aria-describedby={sendBlock ? `wb-send-why-${b.id}` : undefined} onClick={() => setAsking(true)}>
            {busy === "send" ? tr("Sending…") : tr("Send to SAP")}
          </button>
        ) : null}
      </div>
      {!canSend ? null : !can.approve ? <p className="m2-prov">{tr("Sending to SAP needs the approve permission, which your role does not hold.")}</p> : sendBlock ? <p className="m2-prov" id={`wb-send-why-${b.id}`}>{sendBlock}</p> : null}
      {failure ? <ResultFrame outcome={failure} /> : null}

      {check && !run ? (
        <div data-testid="writeback-check">
          <dl className="m2-facts">
            <Fact label={tr("Records")}>{int(check.records)}</Fact>
            <Fact label={tr("Fields by BAPI")}>{int(check.bapi)}</Fact>
            <Fact label={tr("Fields by export")}>{int(check.export_only)}</Fact>
          </dl>
          {check.errors.map((e) => (
            <p key={e} className="m2-prov">
              {e}
            </p>
          ))}
          <Grid<WritebackField> id="writeback-fields" ariaLabel={tr("Fields checked with SAP")} columns={fieldColumns} rows={check.fields} rowId={(f, i) => `${f.record_key}:${f.field}:${i}`} compact height={320} primary={false} fixedColumns hideBar />
        </div>
      ) : null}

      {run ? <RunPanel b={b} run={run} can={can} mine={mine} busy={busy !== null} act={(w) => void runAct(w)} /> : null}

      {asking && check ? (
        <Confirm
          title={tr("Send batch {label} to SAP", { label: b.label })}
          body={tr("{records} {n, plural, one {record is} other {records are}} written to SAP now, in chunks, by a background worker. Each is checked in a test run first, and SAP commits only a record whose answer holds no error. A committed change cannot be taken back from here.", { records: int(check.records), n: check.records })}
          confirm={tr("Send {records} {n, plural, one {record} other {records}}", { records: int(check.records), n: check.records })}
          danger
          pending={busy === "send"}
          onConfirm={() => void runSend()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </section>
  );
}
