"use client";

import "../approvals.css";
import { useState } from "react";
import { formatDate } from "@/lib/format";
import { downloadBatchSheet, getBatch } from "@/lib/api/v2/batches";
import { errorSentence } from "@/lib/api/v2/client";
import { useOpenItem } from "@/lib/v2/hooks";
import { BATCH_STATUS_LABEL, sentLine, trailOf, type BatchRow } from "@/lib/v2/batches";
import { useBatch, useBatchEvents, useBatches } from "@/lib/v2/approvals-queries";
import { int } from "@/lib/v2/score";
import type { RowRef } from "@/lib/v2/work-actions";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { BatchButtons, ReassignMenu, day, money, useBatchControls } from "../screens/batch-parts";
import { useToast } from "../Toast";
import { ResultFrame, useOutcome } from "./shared";
import { CollabSections } from "./collab";
import { DelegationBanner } from "./delegation";
import { t as tr } from "@/lib/v2/i18n";

const SHOWN = 50;
const REASSIGN_MAX = 500;

function Records({ id, total }: { id: string; total: number }) {
  const q = useBatch(id);
  const { hrefFor } = useOpenItem();
  if (q.isLoading) return <Skeleton width="100%" height={96} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("The records of this batch could not be read.")}</ErrorFrame>;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <EmptyFrame>{tr("This batch holds no records.")}</EmptyFrame>;
  return (
    <>
      <ul className="m2-rlist" data-testid="batch-records">
        {items.slice(0, SHOWN).map((it) => (
          <li key={it.id}>
            <V2Link href={hrefFor({ kind: "record", id: `${it.module}:${it.record_key}` })}>
              <Mono>{it.record_key.split("|")[0].replace(/^[A-Z0-9_]+=/, "")}</Mono>
            </V2Link>
            <span>
              <Mono>{it.check_id}</Mono>
            </span>
            <span className="m2-rl-sub">
              {it.field ? <Mono>{it.field}</Mono> : null}
              {it.field ? " " : null}
              {it.current_value ? <Mono>{it.current_value}</Mono> : "blank"}
              {" to "}
              {it.proposed_value ? <Mono>{it.proposed_value}</Mono> : tr("no value yet")}
            </span>
          </li>
        ))}
      </ul>
      <p className="m2-more">
        <span className="m2-meta">{tr("{min} of {total} records shown", { min: int(Math.min(SHOWN, items.length)), total: int(total) })}</span>
        <V2Link href={`/work?filter=open&batch=${encodeURIComponent(id)}`}>{tr("Open all {total} in the ledger", { total: int(total) })}</V2Link>
      </p>
    </>
  );
}

function Trail({ id }: { id: string }) {
  const q = useBatchEvents(id);
  if (q.isLoading) return <Skeleton width="100%" height={72} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("The approval trail could not be read.")}</ErrorFrame>;
  const trail = trailOf(q.data?.items ?? []);
  if (trail.length === 0) return <EmptyFrame>{tr("No step is recorded for this batch yet.")}</EmptyFrame>;
  return (
    <ol className="m2-trail" data-testid="batch-trail">
      {trail.map((t) => (
        <li key={t.key}>
          <div>
            {t.word}
            {t.user ? tr(" by {user}", { user: t.user }) : ""}
            {t.records > 1 ? tr(", {records} records", { records: int(t.records) }) : ""}
          </div>
          {t.note && t.action === "sent_back" ? <p className="m2-tr-note">{t.note}</p> : null}
          <div className="m2-tr-at">{formatDate(t.at, "datetime")}</div>
        </li>
      ))}
    </ol>
  );
}

function BatchBody({ b }: { b: BatchRow }) {
  const toast = useToast();
  const { outcome, run, clear } = useOutcome();
  const controls = useBatchControls((o) => {
    clear();
    void run("result", async () => o);
  });
  const can = controls.can;
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
      toast.show(tr("Sheet saved as {name}", { name }));
    } catch (e) {
      toast.show(errorSentence(e, tr("The sheet could not be built.")), "error");
    } finally {
      setSheet(false);
    }
  };
  const mine = b.ownerId != null && b.ownerId === can.me;
  return (
    <>
      <DelegationBanner />
      <Facts>
        <Fact label={tr("Batch")}>
          <Mono>{b.label}</Mono>
        </Fact>
        <Fact label={tr("Name")}>{b.name}</Fact>
        <Fact label={tr("Status")}>{BATCH_STATUS_LABEL[b.status]}</Fact>
        <Fact label={tr("Owner")}>{b.owner ?? "—"}</Fact>
        <Fact label={tr("Steward")}>{b.steward ?? "—"}</Fact>
        <Fact label={tr("Created")}>{day(b.createdAt)}</Fact>
        <Fact label={tr("Due")}>{day(b.dueAt)}</Fact>
        <Fact label={tr("Records")}>{int(b.records)}</Fact>
        <Fact label={tr("Value at risk")}>{money(b.valueAtRisk)}</Fact>
        {b.approvedBy ? <Fact label={tr("Approved by")}>{`${b.approvedBy}, ${day(b.approvedAt)}`}</Fact> : null}
        {b.status === "exported" ? <Fact label={tr("Sent to SAP")}>{day(b.sentAt)}</Fact> : null}
      </Facts>
      {b.returned ? (
        <p className="m2-prov" data-testid="batch-returned">
          {tr("Sent back{value}{value2}{value3}", { value: b.returned.by ? tr(" by {who}", { who: b.returned.by }) : "", value2: b.returned.at ? tr(" on {date}", { date: day(b.returned.at) }) : "", value3: b.returned.note ? `: ${b.returned.note}` : "." })}
        </p>
      ) : null}
      {b.status === "exported" ? <p className="m2-prov">{sentLine(b, day)}</p> : null}

      <h3>{tr("Records")}</h3>
      <Records id={b.id} total={b.records} />

      <h3>{tr("Approval trail")}</h3>
      <Trail id={b.id} />

      <Actions>
        <BatchButtons b={b} c={controls} sm={false} />
        {b.status === "approved" && can.approve ? (
          <button type="button" className="m2-btn" disabled={mine || controls.busy !== null} title={mine ? tr("You built this batch; a second person sends it back.") : undefined} onClick={() => controls.askSendBack(b)}>
            {tr("Send back")}
          </button>
        ) : null}
        <button type="button" className="m2-btn" disabled={sheet} onClick={() => void download()}>
          {tr("Download sheet")}
        </button>
        {b.status !== "exported" ? <ReassignMenu rows={rows} disabled={!can.assign} subject={tr("batch {label}", { label: b.label })} /> : null}
      </Actions>
      {b.status === "draft" && !can.approve ? <p className="m2-prov">{tr("Approving needs the approve permission, which your role does not hold.")}</p> : null}
      {b.status === "draft" && can.approve && mine ? <p className="m2-prov">{tr("You built this batch, so a second person approves it.")}</p> : null}
      {b.status === "draft" && can.approve && !mine ? <p className="m2-prov">{tr("Approving acts on the whole batch. You can take it back from the notice that follows.")}</p> : null}
      {b.status === "approved" ? <p className="m2-prov">{tr("Send to SAP hands the approved values over as a Migration Cockpit file. It cannot be taken back.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {controls.dialog}
      <CollabSections kind="batch" id={b.id} label={tr("batch {label}", { label: b.label })} />
    </>
  );
}

/** `?open=batch:<id>`: facts, the first records, the approval trail, and the actions the role allows. */
export function BatchInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const list = useBatches();
  const b = list.rows.find((x) => x.id === id) ?? null;
  const status = b ? `${BATCH_STATUS_LABEL[b.status]}${b.records ? tr(", {records} {records2, plural, one {record} other {records}}", { records: int(b.records), records2: b.records }) : ""}` : list.isLoading ? <Skeleton width={120} height={12} /> : tr("Not found");
  return (
    <InspectorFrame title={b ? tr("Batch {label}", { label: b.label }) : tr("Batch")} status={status} onClose={onClose}>
      {b ? (
        <BatchBody b={b} />
      ) : list.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : list.isError ? (
        <ErrorFrame onRetry={() => void list.refetch()}>{tr("The batches could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{tr("This batch is not in the list. It may be empty, or belong to another tenant.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}
