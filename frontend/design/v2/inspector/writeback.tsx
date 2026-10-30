"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { checkBatchWriteback, sendBatchWriteback, type BatchWritebackCheck, type BatchWritebackSend, type SapMessage, type WritebackField } from "@/lib/api/v2/batches";
import { errorSentence } from "@/lib/api/v2/client";
import type { BatchRow } from "@/lib/v2/batches";
import type { BatchCan } from "@/lib/v2/batch-actions";
import { refreshV2 } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Grid, type GridColumn } from "../Grid";
import { Fact } from "../Inspector";
import { Confirm, StatusWord } from "../admin/kit";
import { Dash, Mono } from "../parts";
import { ResultFrame, type Outcome } from "./shared";

/** One line of SAP's answer for a record: the step it came from and its RETURN message. */
interface MessageRow {
  id: string;
  record_key: string;
  result: "sent" | "refused" | "not_sent";
  step: "test" | "commit" | null;
  msg: SapMessage | null;
  error: string | null;
}

const FIELD_COLUMNS = (): GridColumn<WritebackField>[] => [
  { id: "record", header: tr("Record"), width: 190, pin: true, cell: (f) => <Mono>{f.record_key}</Mono> },
  { id: "field", header: tr("Field"), width: 110, cell: (f) => <Mono>{f.field}</Mono> },
  { id: "delivery", header: tr("Goes by"), width: 90, cell: (f) => (f.delivery === "bapi" ? <StatusWord tone="go">{tr("BAPI")}</StatusWord> : <StatusWord tone="at-risk">{tr("Export")}</StatusWord>) },
  { id: "bapi", header: tr("BAPI"), width: 200, cell: (f) => (f.bapi ? <Mono>{f.bapi}</Mono> : <Dash why={tr("No BAPI carries this field yet")} />) },
  { id: "reason", header: tr("Reason"), width: 320, cell: (f) => f.reason ?? tr("A BAPI carries it") },
];

const RESULT_WORD = (r: MessageRow["result"]) => (r === "sent" ? <StatusWord tone="go">{tr("Written to SAP")}</StatusWord> : r === "refused" ? <StatusWord tone="no-go">{tr("Refused by SAP")}</StatusWord> : <StatusWord tone="at-risk">{tr("Not sent")}</StatusWord>);

const MESSAGE_COLUMNS = (): GridColumn<MessageRow>[] => [
  { id: "record", header: tr("Record"), width: 190, pin: true, cell: (m) => <Mono>{m.record_key}</Mono> },
  { id: "result", header: tr("Result"), width: 130, cell: (m) => RESULT_WORD(m.result) },
  { id: "step", header: tr("Step"), width: 90, cell: (m) => (m.step === "test" ? tr("Test run") : m.step === "commit" ? tr("Commit") : <Dash why={tr("SAP was not reached for this record")} />) },
  { id: "type", header: tr("Type"), width: 56, cell: (m) => (m.msg?.type ? <Mono>{m.msg.type}</Mono> : <Dash why={tr("No RETURN message")} />) },
  { id: "msgid", header: tr("Message class"), width: 110, cell: (m) => (m.msg?.id ? <Mono>{m.msg.id}</Mono> : <Dash why={tr("No RETURN message")} />) },
  { id: "number", header: tr("Number"), width: 72, numeric: true, cell: (m) => (m.msg?.number ? <Mono>{m.msg.number}</Mono> : <Dash why={tr("No RETURN message")} />) },
  { id: "text", header: tr("Message"), width: 360, cell: (m) => m.msg?.message || m.error || "" },
];

/** Every RETURN message of every record as one row each, the test run first; a record SAP never saw gets its error. */
export function messageRows(send: BatchWritebackSend): MessageRow[] {
  return send.records.flatMap((r) => {
    const result: MessageRow["result"] = r.committed ? "sent" : r.simulated || r.applied ? "refused" : "not_sent";
    const lines: MessageRow[] = [
      ...r.simulate_messages.map((msg, i) => ({ id: `${r.record_key}:t${i}`, record_key: r.record_key, result, step: "test" as const, msg, error: null })),
      ...r.messages.map((msg, i) => ({ id: `${r.record_key}:c${i}`, record_key: r.record_key, result, step: "commit" as const, msg, error: null })),
    ];
    return lines.length ? lines : [{ id: `${r.record_key}:e`, record_key: r.record_key, result, step: null, msg: null, error: r.error }];
  });
}

/**
 * Live write-back of an approved batch, shown only when the deployment writes to SAP itself (GET /settings
 * `live_writeback`). Step 1, Check with SAP: which fields a BAPI carries and why the others go out with the export;
 * nothing is sent. Step 2, Send to SAP: for an approver who did not build the batch, after a confirmation with the
 * record count; each record is simulated, then committed only when SAP's RETURN holds no error.
 */
export function LiveWriteback({ b, can }: { b: BatchRow; can: BatchCan }) {
  const qc = useQueryClient();
  const [check, setCheck] = useState<BatchWritebackCheck | null>(null);
  const [send, setSend] = useState<BatchWritebackSend | null>(null);
  const [busy, setBusy] = useState<"check" | "send" | null>(null);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<Outcome | null>(null);
  const mine = b.ownerId != null && b.ownerId === can.me;
  const rows = useMemo(() => (send ? messageRows(send) : []), [send]);
  const fieldColumns = useMemo(FIELD_COLUMNS, []);
  const messageColumns = useMemo(MESSAGE_COLUMNS, []);

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
      setSend(await sendBatchWriteback(b.id));
      await refreshV2(qc);
    } catch (e) {
      setFailure({ tone: "fail", title: tr("The batch was not sent to SAP"), detail: errorSentence(e, tr("The batch could not be sent to SAP.")) });
    } finally {
      setBusy(null);
    }
  };

  if (b.status !== "approved" && !send) return null;
  const open = b.status === "approved";
  const sendBlock = !can.approve ? tr("Sending to SAP needs the approve permission, which your role does not hold.") : mine ? tr("You built this batch; a second person sends it.") : !check ? tr("Check with SAP first.") : check.bapi === 0 ? tr("No field of this batch goes by BAPI; deliver it with the load file.") : null;

  return (
    <section aria-label={tr("Live write-back")} data-testid="live-writeback">
      <h3>{tr("Live write-back")}</h3>
      <p className="m2-prov">{tr("This deployment writes approved values to SAP through its BAPIs. Check with SAP first: it says which fields a BAPI carries and why the others go out with the load file. Nothing is sent by the check.")}</p>
      <div className="m2-acts">
        {open && (can.apply || can.approve) ? (
          <button type="button" className="m2-btn" disabled={busy !== null} onClick={() => void runCheck()}>
            {busy === "check" ? tr("Checking…") : check ? tr("Check again") : tr("Check with SAP")}
          </button>
        ) : null}
        {open && can.approve && !send ? (
          <button type="button" className="m2-btn m2-strong" disabled={busy !== null || sendBlock !== null} title={sendBlock ?? undefined} onClick={() => setAsking(true)}>
            {busy === "send" ? tr("Sending…") : tr("Send to SAP")}
          </button>
        ) : null}
      </div>
      {!open ? null : !can.approve ? <p className="m2-prov">{tr("Sending to SAP needs the approve permission, which your role does not hold.")}</p> : mine ? <p className="m2-prov">{tr("You built this batch; a second person sends it.")}</p> : null}
      {failure ? <ResultFrame outcome={failure} /> : null}

      {check && !send ? (
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

      {send ? (
        <div data-testid="writeback-result">
          <p className="m2-prov" data-testid="writeback-summary">
            {tr("Sent {sent}, failed {failed}, export only {exportOnly}.", { sent: int(send.sent), failed: int(send.failed), exportOnly: int(send.export_only) })}
          </p>
          <dl className="m2-facts">
            <Fact label={tr("Records sent")}>{int(send.sent)}</Fact>
            <Fact label={tr("Records failed")}>{int(send.failed)}</Fact>
            <Fact label={tr("Fields for export only")}>{int(send.export_only)}</Fact>
          </dl>
          {send.export_only ? <p className="m2-prov">{tr("The fields without a BAPI were not sent; deliver them with the load file.")}</p> : null}
          <Grid<MessageRow> id="writeback-messages" ariaLabel={tr("What SAP answered, per record")} columns={messageColumns} rows={rows} rowId={(m) => m.id} compact height={360} primary={false} fixedColumns hideBar />
        </div>
      ) : null}

      {asking && check ? (
        <Confirm
          title={tr("Send batch {label} to SAP", { label: b.label })}
          body={tr("{records} {n, plural, one {record is} other {records are}} written to SAP now. Each is checked in a test run first, and SAP commits only a record whose answer holds no error. A committed change cannot be taken back from here.", { records: int(check.records), n: check.records })}
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
