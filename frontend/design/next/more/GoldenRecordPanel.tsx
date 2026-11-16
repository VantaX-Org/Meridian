"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { changedFields } from "@/design/v2/inspector/golden-writeback";
import { failureText } from "@/lib/v2/errors";
import { formatDate } from "@/lib/format";
import { createWritebackRequest, decideWriteback, submitWritebackRequest, type WritebackRequest } from "@/lib/api/v2/golden-writeback";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { mdmKeys, useGoldenHistory, useWritebackPreview, useWritebackRequests } from "@/lib/v2/mdm-queries";
import { refreshV2 } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { DASH, int } from "@/lib/v2/score";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, Skeleton, type ChipTone, type Column } from "../kit";
import { Panel } from "./cfg-parts";

/**
 * The golden-record side panel, native: send the record's values back to SAP (api/routes/golden_writeback.py) with the
 * preview per target, the SAP check that writes nothing, the four-eyes approval and the request list, then the
 * field-level change history (GET /master-records/{id}/history). Same endpoints and guards as the v2 inspector.
 */

const CHANGE_WORD: Record<string, () => string> = {
  promoted: () => t("Promoted to golden"),
  created: () => t("Created"),
  updated: () => t("Updated"),
  merged: () => t("Merged"),
  split: () => t("Split"),
  writeback: () => t("Sent to SAP"),
};

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? DASH : typeof v === "object" ? JSON.stringify(v) : String(v));

const WORKING = new Set(["simulating", "pending_approval", "approved", "applying"]);

const STATUS: Record<string, [ChipTone, () => string]> = {
  simulating: ["neutral", () => t("Checking with SAP")],
  simulated: ["warn", () => t("Checked, not yet sent for approval")],
  simulation_failed: ["bad", () => t("The check failed")],
  pending_approval: ["warn", () => t("Waiting for a second person")],
  approved: ["good", () => t("Approved, waiting to be written")],
  applying: ["neutral", () => t("Writing to SAP")],
  applied: ["good", () => t("Written to SAP")],
  failed: ["bad", () => t("Write to SAP failed")],
  rejected: ["bad", () => t("Rejected")],
  cancelled: ["neutral", () => t("Cancelled")],
};

const RESULT_WORD: Record<string, () => string> = {
  unsupported: () => t("Not carried"),
  unchanged: () => t("Already the same"),
  would_change: () => t("Would change"),
  written: () => t("Written"),
  error: () => t("Error"),
};

type Outcome = { tone: "good" | "bad"; title: string; detail: string };

export function GoldenRecordPanel({ id, status }: { id: string; status: string }) {
  return (
    <>
      <SendToSap id={id} status={status} />
      <FieldHistory id={id} />
    </>
  );
}

function FieldHistory({ id }: { id: string }) {
  const q = useGoldenHistory(id);
  return (
    <Panel title={t("Change history")} testId="gw-history">
      {q.isPending ? (
        <Skeleton lines={3} label={t("Change history")} />
      ) : q.isError ? (
        <ErrorState sentence={t("The change history could not be read.")} onRetry={() => void q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState heading={t("No change has been recorded for this record yet.")} />
      ) : (
        <ul aria-label={t("Field-level change history")} className="nx-body">
          {q.data.map((h) => {
            const diff = h.change_type === "promoted" ? [] : changedFields(h.previous_fields, h.new_fields);
            return (
              <li key={h.id} className="nx-cell-stack">
                <span>
                  {`${formatDate(h.changed_at, "date")} ${CHANGE_WORD[h.change_type]?.() ?? h.change_type}`}
                  {h.changed_by ? `, ${h.changed_by}` : ""}
                  {h.ai_was_involved ? `, ${t("AI recommendation {value}", { value: h.ai_recommendation_accepted ? t("accepted") : t("not accepted") })}` : ""}
                </span>
                {diff.map((d) => (
                  <span key={d.field} className="nx-sub">
                    <Code code={d.field} text={describeField(d.field)} />
                    {`: ${show(d.from)} ${t("to")} ${show(d.to)}`}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

type Field = { field: string; golden_value: unknown; current_value?: unknown; supported: boolean; reason?: string | null; result?: string | null };

function SendToSap({ id, status }: { id: string; status: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const session = useV2Session();
  const golden = status === "golden";
  const preview = useWritebackPreview(id, golden);
  const reqs = useWritebackRequests(id);
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [asking, setAsking] = useState(false);
  const canApply = session.can("apply");
  const canApprove = session.can("approve");
  const list = reqs.data ?? [];
  const latest: WritebackRequest | undefined = list[0];
  const busy = list.some((r) => WORKING.has(r.status));
  const mine = latest !== undefined && latest.requested_by !== null && latest.requested_by !== undefined && latest.requested_by === session.id;
  const changes = latest ? (latest.counts.would_change ?? 0) : 0;

  const run = async (key: string, fn: () => Promise<Omit<Outcome, "tone">>) => {
    setPending(key);
    setOutcome(null);
    try {
      const o = await fn();
      void qc.invalidateQueries({ queryKey: mdmKeys.wbRequests(fixture, id) });
      void refreshV2(qc);
      setOutcome({ tone: "good", ...o });
    } catch (e) {
      setOutcome({ tone: "bad", title: t("It did not go through"), detail: failureText(e) });
    } finally {
      setPending(null);
    }
  };
  const check = () => void run("check", async () => {
    await createWritebackRequest(id);
    return { title: t("Checking with SAP"), detail: t("SAP is read and nothing is written. The result appears below.") };
  });
  const submit = (r: WritebackRequest) => void run("submit", async () => {
    await submitWritebackRequest(id, r.id);
    return { title: t("Sent for approval"), detail: t("A second person sees it in their inbox.") };
  });
  const decide = (action: "approve" | "reject") => {
    setAsking(false);
    void run(action, async () => {
      await decideWriteback(id, action);
      return action === "approve"
        ? { title: t("Approved"), detail: t("The values are written to SAP next.") }
        : { title: t("Rejected"), detail: t("Nothing is written to SAP.") };
    });
  };

  const fieldCols: Column<Field>[] = [
    {
      id: "field", label: t("Field"),
      cell: (f) => (
        <span className="nx-cell-stack">
          <Code code={f.field} text={describeField(f.field)} />
          <span className="nx-sub">{f.result ? (RESULT_WORD[f.result]?.() ?? f.result) : f.supported ? t("Can be written") : (f.reason ?? t("Not carried"))}</span>
        </span>
      ),
    },
    { id: "golden", label: t("Golden value"), cell: (f) => show(f.golden_value) },
    { id: "sap", label: t("In SAP now"), cell: (f) => (f.result && f.result !== "unsupported" ? show(f.current_value) : <span title={t("Not read from SAP yet")}>{DASH}</span>) },
  ];

  return (
    <Panel title={t("Send to SAP")} testId="gw-send">
      {!golden ? (
        <p className="nx-note">{t("Promote this record to golden first. Only an approved golden record is sent to SAP.")}</p>
      ) : preview.isPending ? (
        <Skeleton lines={4} label={t("Send to SAP")} />
      ) : preview.isError ? (
        <ErrorState sentence={t("What would be sent to SAP could not be read.")} onRetry={() => void preview.refetch()} />
      ) : (
        <>
          <dl className="nx-row nx-wrap">
            <div className="nx-cell-stack"><dt className="nx-sub">{t("Golden fields")}</dt><dd>{int(Object.keys(preview.data.golden_fields).length)}</dd></div>
            <div className="nx-cell-stack"><dt className="nx-sub">{t("Systems")}</dt><dd>{int(preview.data.targets.length)}</dd></div>
            <div className="nx-cell-stack"><dt className="nx-sub">{t("Writes to SAP")}</dt><dd>{preview.data.live_enabled ? t("Switched on") : t("Switched off in this deployment")}</dd></div>
          </dl>
          {preview.data.message ? <p className="nx-note">{preview.data.message}</p> : null}
          {preview.data.unresolved_sources.length ? <p className="nx-note">{t("No target is known for the source records {keys}.", { keys: preview.data.unresolved_sources.join(", ") })}</p> : null}
          {preview.data.targets.map((tg) => {
            const planned = latest?.targets.find((x) => x.system_id === tg.system_id);
            const fields = (planned?.fields ?? tg.fields) as Field[];
            const name = tg.system_name ?? tg.system_id;
            return (
              <div key={tg.system_id} className="nx-cell-stack">
                <strong>{name}</strong>
                <span className="nx-sub">{tg.supported ? (tg.method === "rfc_bapi" ? t("Goes by BAPI {bapi}", { bapi: tg.bapi ?? "" }) : t("Goes by OData update")) : (tg.reason ?? t("This system takes no write-back."))}</span>
                <DataTable rows={fields} columns={fieldCols} rowKey={(f) => f.field} rowLabel={(f) => f.field} caption={t("Fields sent to {system}", { system: name })} />
              </div>
            );
          })}
        </>
      )}

      {golden ? (
        <>
          <strong>{t("Requests")}</strong>
          {reqs.isPending ? (
            <Skeleton lines={2} label={t("Requests")} />
          ) : reqs.isError ? (
            <ErrorState sentence={t("The requests could not be read.")} onRetry={() => void reqs.refetch()} />
          ) : !list.length ? (
            <p className="nx-note">{t("Nothing has been sent to SAP for this record.")}</p>
          ) : (
            <ul aria-label={t("Write-back requests")} className="nx-body">
              {list.map((r) => {
                const [tone, word] = STATUS[r.status] ?? ["neutral", () => r.status];
                return (
                  <li key={r.id} className="nx-cell-stack">
                    <span className="nx-row nx-wrap">
                      <span>{formatDate(r.created_at, "date")}</span>
                      <Chip tone={tone}>{word()}</Chip>
                      <span>
                        {r.requested_by ? t("asked by {who}", { who: r.requested_by }) : ""}
                        {r.approved_by ? `, ${t("approved by {who}", { who: r.approved_by })}` : ""}
                        {r.rejected_by ? `, ${t("rejected by {who}", { who: r.rejected_by })}` : ""}
                      </span>
                    </span>
                    {Object.keys(r.counts).length ? <span className="nx-sub">{t("{n} would change, {m} already the same", { n: r.counts.would_change ?? 0, m: r.counts.unchanged ?? 0 })}</span> : null}
                    {r.error ? <span className="nx-sub">{r.error}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="nx-row nx-wrap">
            {canApply && !busy ? (
              <Button variant="secondary" size={32} loading={pending === "check"} disabled={pending !== null} onClick={check} data-testid="gw-check">
                {latest ? t("Check with SAP again") : t("Check with SAP")}
              </Button>
            ) : null}
            {canApply && latest?.status === "simulated" && mine && changes > 0 ? (
              <Button variant="primary" size={32} loading={pending === "submit"} disabled={pending !== null} onClick={() => submit(latest)} data-testid="gw-submit">{t("Send for approval")}</Button>
            ) : null}
            {canApprove && latest?.status === "pending_approval" && !mine ? (
              <>
                <Button variant="primary" size={32} loading={pending === "approve"} disabled={pending !== null} onClick={() => setAsking(true)} data-testid="gw-approve">{t("Approve")}</Button>
                <Button variant="quiet" size={32} loading={pending === "reject"} disabled={pending !== null} onClick={() => decide("reject")} data-testid="gw-reject">{t("Reject")}</Button>
              </>
            ) : null}
          </div>
          {!canApply && !canApprove ? <p className="nx-note">{t("Checking or sending to SAP needs the apply permission, which your role does not hold.")}</p> : null}
          {latest?.status === "simulated" && changes === 0 ? <p className="nx-note">{t("SAP already holds these values. There is nothing to send.")}</p> : null}
          {latest?.status === "pending_approval" && mine ? <p className="nx-note">{t("You asked for this; a second person approves it.")}</p> : null}
          {outcome ? (
            <p className="nx-note nx-row nx-wrap" role="status" data-testid="gw-outcome">
              <Chip tone={outcome.tone}>{outcome.title}</Chip>
              <span>{outcome.detail}</span>
            </p>
          ) : null}
          <Confirm
            open={asking}
            title={t("Approve the write to SAP")}
            consequence={t("{n} {n, plural, one {field is} other {fields are}} written to SAP once you approve. A committed change cannot be taken back from here.", { n: changes })}
            confirmLabel={t("Approve")}
            danger
            onConfirm={() => decide("approve")}
            onCancel={() => setAsking(false)}
          />
        </>
      ) : null}
    </Panel>
  );
}
