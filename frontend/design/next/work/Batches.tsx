"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reassignBatch } from "@/lib/api/v2/batches";
import { errorSentence } from "@/lib/api/v2/client";
import { formatDate, formatMoney } from "@/lib/format";
import { useAssignable, useBatches } from "@/lib/v2/approvals-queries";
import { useBatchActions, useBatchCan } from "@/lib/v2/batch-actions";
import { BATCH_STATUS_LABEL, approveBlock, sentLine, type BatchRow } from "@/lib/v2/batches";
import { t } from "@/lib/v2/i18n";
import { refreshV2 } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { BATCH_CHIPS, type LedgerState } from "@/lib/v2/work";
import { Button, Chip, Code, ErrorState, Sheet, Skeleton, useToast } from "../kit";
import "./queue.css";

const day = (iso: string | null) => (iso ? formatDate(iso, "date") : "");

/**
 * The fix batches of the filtered queue, natively: on Waiting for approval the draft batches, then the approved ones
 * and the last five sent; with ?batch= that one batch. Each card approves, sends back, exports the load file and
 * reassigns, as the v2 batch header did. GET /work/records sends no batch_id per row, so no record sits under a card.
 */
export function WorkBatches({ state, onShow, onOpen }: { state: LedgerState; onShow: (id: string) => void; onOpen: (id: string) => void }) {
  const on = (state.chip !== null && BATCH_CHIPS.has(state.chip)) || Boolean(state.batch);
  const q = useBatches(on);
  if (!on) return null;
  if (q.isPending) return <Skeleton lines={2} />;
  if (q.isError) return <ErrorState sentence={t("The batches could not be read.")} onRetry={() => void q.refetch()} />;
  const all = q.rows;
  const list: BatchRow[] = state.batch
    ? all.filter((b) => b.id === state.batch)
    : state.chip === "approvals"
      ? [
          ...all.filter((b) => b.status === "draft"),
          ...(!state.rule && !state.module
            ? [
                ...all.filter((b) => b.status === "approved"),
                ...all.filter((b) => b.status === "exported").sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")).slice(0, 5),
              ]
            : []),
        ]
      : [];
  if (!list.length) return null;
  return (
    <section className="nx-wq-batches" aria-label={t("Fix batches")}>
      {list.map((b) => <BatchCard key={b.id} b={b} onShow={onShow} onOpen={onOpen} />)}
    </section>
  );
}

function BatchCard({ b, onShow, onOpen }: { b: BatchRow; onShow: (id: string) => void; onOpen: (id: string) => void }) {
  const can = useBatchCan();
  const actions = useBatchActions();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [blank, setBlank] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const [note, setNote] = useState("");
  const [exporting, setExporting] = useState(false);
  const [loader, setLoader] = useState("");
  const [owner, setOwner] = useState("");
  const people = useAssignable(can.assign);
  const loaderName = (people.data ?? []).find((u) => u.id === loader)?.name ?? t("The SAP Basis people");
  const block = approveBlock(b, can, can.me);
  const fail = (e: unknown, fallback: string) => toast({ text: errorSentence(e, fallback), tone: "bad" });

  const approve = async (withoutBlank = false) => {
    setBusy("approve");
    try {
      await actions.approve(b.id, b.label, withoutBlank);
      setBlank(null);
      toast({ text: t("Approved batch {label}", { label: b.label }), tone: "good" });
    } catch (e) {
      const sentence = errorSentence(e, "");
      if (!withoutBlank && / no new value: /.test(sentence)) setBlank(sentence);
      else fail(e, t("The batch could not be approved."));
    } finally {
      setBusy(null);
    }
  };
  const sendBack = async () => {
    setBusy("back");
    try {
      await actions.sendBack(b.id, b.label, note.trim());
      setBack(false);
      setBlank(null);
      setNote("");
      toast({ text: t("Sent batch {label} back", { label: b.label }), tone: "good" });
    } catch (e) {
      fail(e, t("The batch could not be sent back."));
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    setExporting(false);
    setBusy("send");
    try {
      const r = await actions.sendToSap(b.id, b.records, loader || null);
      toast({ text: t("Exported the load file of batch {label} as {filename}", { label: b.label, filename: r.filename }), tone: "good" });
    } catch (e) {
      fail(e, t("The batch could not be sent to SAP."));
    } finally {
      setBusy(null);
    }
  };
  const reassign = async (uid: string) => {
    if (!uid) return;
    setOwner(uid);
    try {
      const r = await reassignBatch(b.id, uid);
      await refreshV2(qc);
      const name = (people.data ?? []).find((u) => u.id === uid)?.name ?? uid;
      toast({ text: t("Batch {label}: {count} {count2, plural, one {record} other {records}} reassigned to {name}", { label: b.label, count: int(r.reassigned), count2: r.reassigned, name }), tone: "good" });
    } catch (e) {
      fail(e, t("The batch could not be reassigned."));
    } finally {
      setOwner("");
    }
  };

  return (
    <article className="nx-wq-card" data-testid={`batch-row-${b.id}`}>
      <div className="nx-wq-row">
        <Button variant="quiet" size={32} aria-label={t("Open batch {label}", { label: b.label })} onClick={() => onOpen(b.id)}><Code code={b.label} /></Button>
        <strong>{b.name}</strong>
        <Chip tone={b.status === "draft" ? "warn" : b.status === "exported" ? "resolved" : "neutral"}>{BATCH_STATUS_LABEL[b.status]}</Chip>
      </div>
      <p className="nx-wq-meta">
        {b.status === "exported"
          ? sentLine(b, day)
          : [
              b.status === "approved" ? (b.approvedBy ? t("Approved by {approvedBy}", { approvedBy: b.approvedBy }) : t("Approved")) : (b.owner ?? t("No owner")),
              t("{records} {records2, plural, one {record} other {records}}", { records: int(b.records), records2: b.records }),
              b.valueAtRisk == null ? t("no value at risk") : `${formatMoney(b.valueAtRisk)} ${t("at risk")}`,
              b.dueAt ? t("due {day}", { day: day(b.dueAt) }) : t("no due date"),
            ].join(", ")}
      </p>
      <div className="nx-wq-row">
        {b.status === "draft" && can.approve ? (
          <>
            <Button variant="primary" size={32} disabled={!!block || busy !== null} loading={busy === "approve"} aria-label={t("Approve batch {label}", { label: b.label })} onClick={() => void approve()}>
              {busy === "approve" ? t("Approving…") : t("Approve")}
            </Button>
            <Button variant="secondary" size={32} disabled={!!block || busy !== null} aria-label={t("Send batch {label} back", { label: b.label })} onClick={() => setBack(true)}>{t("Send back")}</Button>
            {block ? <small className="nx-wq-meta">{block}</small> : null}
          </>
        ) : null}
        {b.status === "approved" && can.send ? (
          <>
            <Button variant="primary" size={32} disabled={(!!b.ownerId && b.ownerId === can.me) || busy !== null} loading={busy === "send"} aria-label={t("Export batch {label} as a load file", { label: b.label })} onClick={() => { setLoader(""); setExporting(true); }}>
              {busy === "send" ? t("Exporting…") : t("Export load file")}
            </Button>
            {b.ownerId && b.ownerId === can.me ? <small className="nx-wq-meta">{t("You built this batch; a second person sends it.")}</small> : null}
          </>
        ) : null}
        {b.status !== "draft" ? <Button variant="quiet" size={32} onClick={() => onShow(b.id)}>{t("Show records")}</Button> : null}
        {can.assign ? (
          <label className="nx-wq-row">{t("Reassign whole batch")}
            <select aria-label={t("Reassign batch {label}", { label: b.label })} value={owner} disabled={people.isLoading || people.isError || !!owner} onChange={(e) => void reassign(e.target.value)}>
              <option value="">{people.isLoading ? t("Reading the people…") : people.isError ? t("The people could not be read") : t("Reassign to")}</option>
              {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <Sheet
        open={exporting}
        onClose={() => setExporting(false)}
        title={t("Export the load file")}
        size="small"
        primary={<Button variant="primary" onClick={() => void send()}>{t("Export load file")}</Button>}
        secondary={<Button variant="quiet" onClick={() => setExporting(false)}>{t("Cancel")}</Button>}
      >
        <div className="nx-wq-form">
          <p className="nx-wq-meta">{t("Batch {label}: {records} {records2, plural, one {record goes} other {records go}} out as a Migration Cockpit file. Nothing changes in SAP until the file is loaded, and the export cannot be taken back.", { label: b.label, records: int(b.records), records2: b.records })}</p>
          {can.assign ? (
            <label>{t("Who loads it in SAP")}
              <select value={loader} onChange={(e) => setLoader(e.target.value)} disabled={people.isLoading}>
                <option value="">{t("The SAP Basis people")}</option>
                {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          ) : null}
          <p data-testid="export-loader">{t("{who} gets the file in the inbox, loads it and confirms the load here.", { who: loaderName })}</p>
        </div>
      </Sheet>
      <Sheet
        open={blank !== null}
        onClose={() => setBlank(null)}
        title={t("Some records have no new value")}
        size="small"
        primary={<Button variant="primary" loading={busy === "approve"} onClick={() => void approve(true)}>{t("Approve the others")}</Button>}
        secondary={
          <>
            <Button variant="quiet" onClick={() => setBlank(null)}>{t("Cancel")}</Button>
            <Button variant="secondary" onClick={() => { setBlank(null); setBack(true); }}>{t("Send back")}</Button>
          </>
        }
      >
        <p className="nx-wq-meta">{blank}</p>
      </Sheet>
      <Sheet
        open={back}
        onClose={() => setBack(false)}
        title={t("Send the batch back")}
        size="small"
        dirty={!!note.trim()}
        primary={<Button variant="primary" disabled={!note.trim()} loading={busy === "back"} onClick={() => void sendBack()}>{t("Send back")}</Button>}
        secondary={<Button variant="quiet" onClick={() => setBack(false)}>{t("Cancel")}</Button>}
      >
        <div className="nx-wq-form">
          <p className="nx-wq-meta">{t("Batch {label} returns to its author with your reason.", { label: b.label })}</p>
          <label>{t("What the author has to change")}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </Sheet>
    </article>
  );
}
