"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { downloadBatchSheet, getBatch, reassignBatch } from "@/lib/api/v2/batches";
import { errorSentence } from "@/lib/api/v2/client";
import { useOpenItem } from "@/lib/v2/hooks";
import { BATCH_STATUS_LABEL, approveBlock, sentLine, trailOf, type BatchRow } from "@/lib/v2/batches";
import { useAssignable, useBatch, useBatchEvents, useBatches } from "@/lib/v2/approvals-queries";
import { useBatchActions, useBatchCan } from "@/lib/v2/batch-actions";
import { useWorkActions, type RowRef } from "@/lib/v2/work-actions";
import { useTenantSettings } from "@/lib/v2/admin-queries";
import { refreshV2 } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { daysUntil } from "@/lib/v2/waves";
import { splitKey } from "@/lib/v2/work";
import { alphaOut } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Button, Code, Confirm, EmptyState, ErrorState, Popover, Skeleton, useToast } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Note, OutcomeLine, Sec, WorkflowSteps, useOutcome, type Outcome } from "./work-common";
import { DelegationBanner } from "./work-delegation";

const SHOWN = 50;
const REASSIGN_MAX = 500;

export const day = (iso: string | null | undefined): string => (iso ? formatDate(iso, "date") : "—");
export const money = (n: number | null | undefined) =>
  n == null ? <Dash why={t("The cost model has not priced this batch")} /> : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const keyPart = (key: string, i: number): string | null => splitKey(key)[i]?.value ?? null;

function KeyText({ value }: { value: string }) {
  const shown = alphaOut(value);
  return <span className="nx-wk-mono" title={shown === value ? undefined : value} data-key={value}>{shown}</span>;
}

function SlaClock({ status, dueAt }: { status: string; dueAt: string | null | undefined }) {
  const d = status === "draft" || status === "approved" || status === "awaiting_load" ? daysUntil(dueAt ?? null) : null;
  if (d == null) return null;
  return (
    <Note>
      <span data-testid="batch-sla" data-late={d < 0 || undefined}>
        {d < 0 ? t("{n} {count, plural, one {day} other {days}} past the due date.", { n: int(-d), count: -d }) : d === 0 ? t("Due today.") : t("Due in {n} {count, plural, one {day} other {days}}.", { n: int(d), count: d })}
      </span>
    </Note>
  );
}

function Records({ id, total }: { id: string; total: number }) {
  const q = useBatch(id);
  const { hrefFor } = useOpenItem();
  if (q.isLoading) return <Skeleton lines={4} label={t("Records")} />;
  if (q.isError) return <ErrorState sentence={t("The records of this batch could not be read.")} onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <EmptyState heading={t("This batch holds no records.")} />;
  return (
    <>
      <ul className="nx-ib-list" data-testid="batch-records">
        {items.slice(0, SHOWN).map((it) => (
          <li key={it.id}>
            <V2Link href={hrefFor({ kind: "record", id: `${it.module}:${it.record_key}` })}>
              <KeyText value={keyPart(it.record_key, 0) ?? it.record_key} />
            </V2Link>
            {keyPart(it.record_key, 1) ? <> <span className="nx-wk-mono">{keyPart(it.record_key, 1)}</span></> : null}{" "}
            <Code code={it.check_id} />
            <div className="nx-ib-meta">
              {it.field ? <Code code={it.field} text={describeField(it.field) ?? undefined} /> : null}
              {it.field ? " " : null}
              {it.current_value ? <span className="nx-wk-mono">{it.current_value}</span> : t("blank")}
              {" "}{t("to")}{" "}
              {it.proposed_value ? <span className="nx-wk-mono">{it.proposed_value}</span> : t("no value yet")}
            </div>
          </li>
        ))}
      </ul>
      <Note>
        {t("{min} of {total} records shown", { min: int(Math.min(SHOWN, items.length)), total: int(total) })}{" "}
        <V2Link href={`/work?filter=open&batch=${encodeURIComponent(id)}`}>{t("Open all {total} in the ledger", { total: int(total) })}</V2Link>
      </Note>
    </>
  );
}

function Trail({ id }: { id: string }) {
  const q = useBatchEvents(id);
  if (q.isLoading) return <Skeleton lines={3} label={t("Approval trail")} />;
  if (q.isError) return <ErrorState sentence={t("The approval trail could not be read.")} onRetry={() => void q.refetch()} />;
  const trail = trailOf(q.data?.items ?? []);
  if (trail.length === 0) return <EmptyState heading={t("No step is recorded for this batch yet.")} />;
  return (
    <ol className="nx-ib-list" data-testid="batch-trail">
      {trail.map((x) => (
        <li key={x.key}>
          <div>
            {x.word}
            {x.user ? t(" by {user}", { user: x.user }) : ""}
            {x.records > 1 ? t(", {records} records", { records: int(x.records) }) : ""}
          </div>
          {x.note && x.action === "sent_back" ? <p className="nx-wk-quote">{x.note}</p> : null}
          <div className="nx-ib-meta">{formatDate(x.at, "datetime")}</div>
        </li>
      ))}
    </ol>
  );
}

function Steps({ id }: { id: string }) {
  const q = useBatch(id);
  const tasks = q.data?.workflow?.tasks ?? [];
  if (tasks.length === 0) return null;
  return (
    <Sec title={t("Approval steps")}>
      <WorkflowSteps tasks={tasks} testId="batch-steps" />
    </Sec>
  );
}

interface Person { id: string; name: string; email?: string | null }

/** A button that opens a list of the people work can go to; picking one calls `onPick`. */
function PeoplePicker({ label, text, disabled, reason, onPick }: { label: string; text: string; disabled?: boolean; reason?: string; onPick: (u: Person) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const people = useAssignable(open);
  return (
    <span ref={setAnchor}>
      <Button variant="secondary" aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={disabled} reason={reason} onClick={() => setOpen((o) => !o)}>
        {text}
      </Button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={t("Reassign to")}>
        <div role="menu" aria-label={t("Reassign to")}>
          <h4>{t("Reassign to")}</h4>
          {people.isLoading ? <p>{t("Reading the people…")}</p> : people.isError ? <p>{t("The people could not be read")}</p> : null}
          {(people.data ?? []).map((u) => (
            <button key={u.id} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(u); }}>
              {u.name}
              {u.email ? <span className="nx-ib-meta"> {u.email}</span> : null}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}

export function ReassignMenu({ rows, disabled, subject }: { rows: () => Promise<{ rows: RowRef[]; total: number }>; disabled: boolean; subject: string }) {
  const actions = useWorkActions();
  const toast = useToast();
  const pick = async (u: Person) => {
    try {
      const r = await rows();
      if (r.rows.length === 0) {
        toast({ text: t("There are no open records to reassign.") });
        return;
      }
      const more = r.total > r.rows.length ? t("; {count} more remain, reassign again for the rest", { count: int(r.total - r.rows.length) }) : "";
      await actions.decide(r.rows, "assign", { assignee: u.id, label: t("Reassigned {rowsCount} {rowsCount2, plural, one {record} other {records}} of {subject} to {name}{more}", { rowsCount: int(r.rows.length), rowsCount2: r.rows.length, subject, name: u.name, more }) });
    } catch (e) {
      toast({ text: errorSentence(e, t("The records could not be reassigned.")), tone: "bad" });
    }
  };
  return <PeoplePicker label={t("Reassign")} text={t("Reassign…")} disabled={disabled} reason={disabled ? t("Your role cannot assign work") : undefined} onPick={(u) => void pick(u)} />;
}

function ReassignBatch({ b, can }: { b: BatchRow; can: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  if (!can) return null;
  const pick = async (u: Person) => {
    try {
      const r = await reassignBatch(b.id, u.id);
      await refreshV2(qc);
      toast({ text: t("Batch {label}: {count} {count2, plural, one {record} other {records}} reassigned to {name}", { label: b.label, count: int(r.reassigned), count2: r.reassigned, name: u.name }), tone: "good" });
    } catch (e) {
      toast({ text: errorSentence(e, t("The batch could not be reassigned.")), tone: "bad" });
    }
  };
  return <PeoplePicker label={t("Reassign batch {label}", { label: b.label })} text={t("Reassign whole batch")} onPick={(u) => void pick(u)} />;
}

function BatchBody({ b }: { b: BatchRow }) {
  const toast = useToast();
  const can = useBatchCan();
  const actions = useBatchActions();
  const { outcome, run, clear } = useOutcome();
  const report = (o: Outcome) => { clear(); void run("result", async () => o); };
  const fail = (e: unknown, fallback: string) => report({ tone: "fail", title: t("It did not go through"), detail: errorSentence(e, fallback) });
  const [busy, setBusy] = useState<string | null>(null);
  const [back, setBack] = useState(false);
  const [note, setNote] = useState("");
  const [blank, setBlank] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loader, setLoader] = useState("");
  const people = useAssignable(exporting && can.assign);
  const mine = b.ownerId != null && b.ownerId === can.me;
  const block = approveBlock(b, can, can.me);
  const liveOn = useTenantSettings().data?.live_writeback === true;
  const live = liveOn && b.status === "approved";

  const approve = async (withoutBlank: boolean) => {
    setBlank(null);
    setBusy("approve");
    try {
      await actions.approve(b.id, b.label, withoutBlank);
    } catch (e) {
      const s = errorSentence(e, t("The batch could not be approved."));
      if (!withoutBlank && / no new value: /.test(s)) setBlank(s);
      else fail(e, t("The batch could not be approved."));
    } finally {
      setBusy(null);
    }
  };
  const sendBack = async () => {
    const reason = note.trim();
    setBack(false);
    setNote("");
    setBusy("back");
    try {
      await actions.sendBack(b.id, b.label, reason);
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
      const sum = r.sha256 ? t(", sha256 {sha256}", { sha256: r.sha256.slice(0, 12) }) : "";
      const n = r.records ?? b.records;
      report({ tone: "ok", title: t("Load file exported, {records} {records2, plural, one {record} other {records}}", { records: int(n), records2: n }), detail: t("{filename}{sum}. Load it into SAP with the Migration Cockpit, then confirm the load on the batch.", { filename: r.filename, sum }), job: r.job_id });
    } catch (e) {
      fail(e, t("The batch could not be sent to SAP."));
    } finally {
      setBusy(null);
    }
  };
  const rows = async (): Promise<{ rows: RowRef[]; total: number }> => {
    const d = await getBatch(b.id);
    const picked = d.items.slice(0, REASSIGN_MAX).map<RowRef>((i) => ({ module: i.module, record_key: i.record_key, checks: [i.check_id], suggested_value: null, status: "proposed" }));
    return { rows: picked, total: d.items.length };
  };
  const [sheet, setSheet] = useState(false);
  const download = async () => {
    setSheet(true);
    try {
      const d = await getBatch(b.id);
      const name = downloadBatchSheet(b.label, d.items);
      toast({ text: t("Sheet saved as {name}", { name }), tone: "good" });
    } catch (e) {
      toast({ text: errorSentence(e, t("The sheet could not be built.")), tone: "bad" });
    } finally {
      setSheet(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const confirmLoad = async () => {
    setLoading(true);
    try {
      await actions.confirmLoaded(b.id, b.label, null);
    } catch (e) {
      toast({ text: errorSentence(e, t("The load could not be confirmed.")), tone: "bad" });
    } finally {
      setLoading(false);
    }
  };
  const who = loader ? (people.data ?? []).find((p) => p.id === loader)?.name ?? loader : t("The SAP Basis people");

  return (
    <>
      <DelegationBanner />
      <Facts>
        <Fact label={t("Batch")}><span className="nx-wk-mono">{b.label}</span></Fact>
        <Fact label={t("Name")}>{b.name}</Fact>
        <Fact label={t("Status")}>{BATCH_STATUS_LABEL[b.status]}</Fact>
        <Fact label={t("Owner")}>{b.owner ?? "—"}</Fact>
        <Fact label={t("Steward")}>{b.steward ?? "—"}</Fact>
        <Fact label={t("Created")}>{day(b.createdAt)}</Fact>
        <Fact label={t("Due")}>{day(b.dueAt)}</Fact>
        <Fact label={t("Records")}>{int(b.records)}</Fact>
        <Fact label={t("Value at risk")}>{money(b.valueAtRisk)}</Fact>
        {b.approvedBy ? <Fact label={t("Approved by")}>{`${b.approvedBy}, ${day(b.approvedAt)}`}</Fact> : null}
        {b.status === "awaiting_load" ? <Fact label={t("Load file exported")}>{day(b.sentAt)}</Fact> : null}
        {b.status === "exported" ? <Fact label={t("Sent to SAP")}>{day(b.sentAt)}</Fact> : null}
      </Facts>
      {b.returned ? (
        <Note>
          <span data-testid="batch-returned">
            {t("Sent back{value}{value2}{value3}", { value: b.returned.by ? t(" by {who}", { who: b.returned.by }) : "", value2: b.returned.at ? t(" on {date}", { date: day(b.returned.at) }) : "", value3: b.returned.note ? `: ${b.returned.note}` : "." })}
          </span>
        </Note>
      ) : null}
      <SlaClock status={b.status} dueAt={b.dueAt} />
      {b.status === "exported" ? <Note>{sentLine(b, day)}</Note> : null}
      {b.verification ? (
        <Note>
          <span data-testid="batch-verified">
            {t("Verified on run {date}: {fixed} fixed, {failing} still failing.", { date: day(b.verification.runAt), fixed: int(b.verification.fixed), failing: int(b.verification.stillFailing) })}
          </span>
          {b.verification.stillFailing > 0 ? <> <V2Link href={`/work?batch=${encodeURIComponent(b.id)}`}>{t("Open the {count}", { count: int(b.verification.stillFailing) })}</V2Link></> : null}
        </Note>
      ) : null}

      <Sec title={t("Records")}><Records id={b.id} total={b.records} /></Sec>
      <Steps id={b.id} />
      <Sec title={t("Approval trail")}><Trail id={b.id} /></Sec>

      <Actions>
        {b.status === "draft" && can.approve ? (
          <>
            <Button variant="primary" aria-label={t("Approve batch {label}", { label: b.label })} disabled={block !== null || busy !== null} reason={block ?? undefined} loading={busy === "approve"} loadingLabel={t("Approving…")} onClick={() => void approve(false)}>
              {t("Approve")}
            </Button>
            <Button aria-label={t("Send batch {label} back", { label: b.label })} disabled={block !== null || busy !== null} onClick={() => setBack(true)}>
              {t("Send back")}
            </Button>
          </>
        ) : null}
        {b.status === "approved" && can.send ? (
          <Button variant={live ? "secondary" : "primary"} aria-label={t("Export batch {label} as a load file", { label: b.label })} disabled={busy !== null || mine} reason={mine ? t("You built this batch; a second person sends it.") : undefined} loading={busy === "send"} loadingLabel={t("Exporting…")} onClick={() => setExporting(true)}>
            {t("Export load file")}
          </Button>
        ) : null}
        {b.status === "approved" && can.approve ? (
          <Button disabled={mine || busy !== null} reason={mine ? t("You built this batch; a second person sends it back.") : undefined} onClick={() => setBack(true)}>
            {t("Send back")}
          </Button>
        ) : null}
        <Button disabled={sheet} onClick={() => void download()}>{t("Download sheet")}</Button>
        {b.status === "awaiting_load" && can.confirmLoad ? (
          <Button variant="primary" disabled={mine || loading} reason={mine ? t("You built this batch; a second person confirms the load.") : undefined} onClick={() => void confirmLoad()}>
            {t("Loaded in SAP")}
          </Button>
        ) : null}
        {b.status === "draft" || b.status === "approved" ? <ReassignBatch b={b} can={can.assign} /> : null}
        {b.status !== "exported" ? <ReassignMenu rows={rows} disabled={!can.assign} subject={t("batch {label}", { label: b.label })} /> : null}
      </Actions>
      {b.status === "draft" && !can.approve ? <Note>{t("Approving needs the approve permission, which your role does not hold.")}</Note> : null}
      {b.status === "draft" && can.approve && !mine ? <Note>{t("Approving acts on the whole batch. You can take it back from the notice that follows.")}</Note> : null}
      {b.status === "approved" && !live ? <Note>{t("Export load file hands the approved values over as a Migration Cockpit file, for the person you name to load in SAP. It cannot be taken back.")}</Note> : null}
      {b.status === "approved" && live ? <Note>{t("Export load file hands the approved values over as a Migration Cockpit file instead of writing them live. It cannot be taken back.")}</Note> : null}
      {b.status === "awaiting_load" ? <Note><span data-testid="batch-awaiting-load">{t("The load file is out and waits for the SAP load. Once it is loaded in SAP, an approver or SAP Basis confirms it here; the next run then checks the records.")}</span></Note> : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}

      <Confirm
        open={exporting}
        title={t("Export the load file")}
        consequence={
          <div className="nx-wk-form">
            <p>{t("Batch {label}: {records} {records2, plural, one {record goes} other {records go}} out as a Migration Cockpit file. Nothing changes in SAP until the file is loaded, and the export cannot be taken back.", { label: b.label, records: int(b.records), records2: b.records })}</p>
            {can.assign ? (
              <label>
                {t("Who loads it in SAP")}
                <select value={loader} onChange={(e) => setLoader(e.target.value)}>
                  <option value="">{t("The SAP Basis people")}</option>
                  {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            ) : null}
            <p data-testid="export-loader">{t("{who} gets the file in the inbox, loads it and confirms the load here.", { who })}</p>
          </div>
        }
        confirmLabel={t("Export load file")}
        onCancel={() => setExporting(false)}
        onConfirm={() => void send()}
      />
      <Confirm
        open={blank !== null && !back}
        title={t("Some records have no new value")}
        consequence={
          <div className="nx-wk-form">
            <p>{blank}</p>
            <Button onClick={() => { setBlank(null); setBack(true); }}>{t("Send back")}</Button>
          </div>
        }
        confirmLabel={t("Approve the others")}
        onCancel={() => setBlank(null)}
        onConfirm={() => void approve(true)}
      />
      <Confirm
        open={back}
        title={t("Send the batch back")}
        consequence={
          <div className="nx-wk-form">
            <p>{t("Batch {label} returns to its author with your reason.", { label: b.label })}</p>
            <label>
              {t("What the author has to change")}
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        }
        blocked={note.trim() ? undefined : t("What the author has to change")}
        confirmLabel={t("Send back")}
        onCancel={() => { setBack(false); setNote(""); }}
        onConfirm={() => void sendBack()}
      />
    </>
  );
}

/** `?open=batch:<id>`: facts, the first records, the approval trail, and the actions the role allows. */
export function BatchBodyView({ id, onClose }: BodyProps) {
  const list = useBatches();
  const b = list.rows.find((x) => x.id === id) ?? null;
  const status = b ? `${BATCH_STATUS_LABEL[b.status]}${b.records ? t(", {records} {records2, plural, one {record} other {records}}", { records: int(b.records), records2: b.records }) : ""}` : list.isLoading ? null : t("Not found");
  return (
    <InspectorFrame title={b ? t("Batch {label}", { label: b.label }) : t("Batch")} status={status} onClose={onClose}>
      {b ? (
        <BatchBody b={b} />
      ) : list.isLoading ? (
        <Skeleton lines={6} label={t("Batch")} />
      ) : list.isError ? (
        <ErrorState sentence={t("The batches could not be read.")} onRetry={() => void list.refetch()} />
      ) : (
        <EmptyState heading={t("Not found")}>{t("This batch is not in the list. It may be empty, or belong to another tenant.")}</EmptyState>
      )}
    </InspectorFrame>
  );
}
