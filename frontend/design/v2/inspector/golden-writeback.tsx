"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { createWritebackRequest, decideWriteback, promoteGolden, submitWritebackRequest, type WritebackRequest } from "@/lib/api/v2/golden-writeback";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { mdmKeys, useGoldenHistory, useWritebackPreview, useWritebackRequests } from "@/lib/v2/mdm-queries";
import { refreshV2 } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { useFixture } from "@/lib/api/v2/fixture";
import { Fact } from "../Inspector";
import { Confirm, StatusWord } from "../admin/kit";
import { Coded, Dash, ErrorFrame, Skeleton } from "../parts";
import { FactList, Sec } from "./mdm-parts";
import { ResultFrame, useOutcome } from "./shared";

const CHANGE_WORD: Record<string, string> = {
  get promoted() { return t("Promoted to golden"); },
  get created() { return t("Created"); },
  get updated() { return t("Updated"); },
  get merged() { return t("Merged"); },
  get split() { return t("Split"); },
  get writeback() { return t("Sent to SAP"); },
};

const show = (v: unknown): string => (v == null || v === "" ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The fields whose value differs between two snapshots of the record. */
export function changedFields(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): { field: string; from: unknown; to: unknown }[] {
  const a = prev ?? {};
  const b = next ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => show(a[f]) !== show(b[f])).map((f) => ({ field: f, from: a[f], to: b[f] }));
}

/** Field-level audit trail (GET /master-records/{id}/history): who changed which value to which, and when. */
export function FieldHistory({ id }: { id: string }) {
  const q = useGoldenHistory(id);
  return (
    <Sec title={t("Change history")}>
      {q.isPending ? (
        <Skeleton width="100%" height={50} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The change history could not be read.")}</ErrorFrame>
      ) : (q.data ?? []).length === 0 ? (
        <p className="m2-rp m2-meta">{t("No change has been recorded for this record yet.")}</p>
      ) : (
        <ul className="m2-hist" aria-label={t("Field-level change history")}>
          {(q.data ?? []).map((h) => {
            const diff = h.change_type === "promoted" ? [] : changedFields(h.previous_fields, h.new_fields);
            return (
              <li key={h.id}>
                <span className="m2-d">{formatDate(h.changed_at, "date")}</span>
                <span>
                  {CHANGE_WORD[h.change_type] ?? h.change_type}
                  {h.changed_by ? `, ${h.changed_by}` : ""}
                  {h.ai_was_involved ? `, ${t("AI recommendation {value}", { value: h.ai_recommendation_accepted ? t("accepted") : t("not accepted") })}` : ""}
                  {diff.map((d) => (
                    <span key={d.field} className="m2-meta m2-fdiff">
                      <Coded code={d.field} text={describeField(d.field)} />
                      {`: ${show(d.from)} ${t("to")} ${show(d.to)}`}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Sec>
  );
}

/** Promote a record waiting for review to golden (POST /master-records/{id}/promote). Needs approve. */
export function PromoteAction({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  if (!session.can("approve")) return <p className="m2-rp m2-meta">{t("Promoting a record to golden needs the approve permission. A data owner can do it.")}</p>;
  const go = () =>
    void run("promote", async () => {
      const res = await promoteGolden(id);
      void refreshV2(qc);
      return { tone: "ok", title: t("Promoted to golden"), detail: res.related_reviews_queued ? t("{n} related {n, plural, one {record was} other {records were}} queued for review.", { n: res.related_reviews_queued }) : t("No related record needed a review.") };
    });
  return (
    <div className="m2-aform">
      <div className="m2-acts">
        <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={go}>
          {pending === "promote" ? t("Promoting…") : t("Promote to golden")}
        </button>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </div>
  );
}

const WORKING = new Set(["simulating", "pending_approval", "approved", "applying"]);

const STATUS_WORD = (s: string) => {
  switch (s) {
    case "simulating": return <StatusWord tone="neutral">{t("Checking with SAP")}</StatusWord>;
    case "simulated": return <StatusWord tone="at-risk">{t("Checked, not yet sent for approval")}</StatusWord>;
    case "simulation_failed": return <StatusWord tone="no-go">{t("The check failed")}</StatusWord>;
    case "pending_approval": return <StatusWord tone="at-risk">{t("Waiting for a second person")}</StatusWord>;
    case "approved": return <StatusWord tone="go">{t("Approved, waiting to be written")}</StatusWord>;
    case "applying": return <StatusWord tone="neutral">{t("Writing to SAP")}</StatusWord>;
    case "applied": return <StatusWord tone="go">{t("Written to SAP")}</StatusWord>;
    case "failed": return <StatusWord tone="no-go">{t("Write to SAP failed")}</StatusWord>;
    case "rejected": return <StatusWord tone="no-go">{t("Rejected")}</StatusWord>;
    case "cancelled": return <StatusWord tone="neutral">{t("Cancelled")}</StatusWord>;
    default: return <StatusWord tone="neutral">{s}</StatusWord>;
  }
};

const RESULT_WORD: Record<string, () => string> = {
  unsupported: () => t("Not carried"),
  unchanged: () => t("Already the same"),
  would_change: () => t("Would change"),
  written: () => t("Written"),
  error: () => t("Error"),
};

/**
 * Send a golden record's values back to SAP (api/routes/golden_writeback.py): preview the targets and the fields each
 * can take, check with SAP (a simulation that writes nothing), send for a second person's approval, and approve or
 * reject as that second person. The same decision is reached from the inbox task, which opens this inspector.
 */
export function SendToSap({ id, status }: { id: string; status: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const session = useV2Session();
  const golden = status === "golden";
  const preview = useWritebackPreview(id, golden);
  const reqs = useWritebackRequests(id);
  const { outcome, pending, run } = useOutcome();
  const [asking, setAsking] = useState(false);
  const canApply = session.can("apply");
  const canApprove = session.can("approve");
  const list = reqs.data ?? [];
  const latest: WritebackRequest | undefined = list[0];
  const busy = list.some((r) => WORKING.has(r.status));
  const mine = latest != null && latest.requested_by != null && latest.requested_by === session.id;
  const changes = latest ? (latest.counts.would_change ?? 0) : 0;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: mdmKeys.wbRequests(fixture, id) });
    void refreshV2(qc);
  };
  const check = () =>
    void run("check", async () => {
      await createWritebackRequest(id);
      refresh();
      return { tone: "ok", title: t("Checking with SAP"), detail: t("SAP is read and nothing is written. The result appears below.") };
    });
  const submit = (r: WritebackRequest) =>
    void run("submit", async () => {
      await submitWritebackRequest(id, r.id);
      refresh();
      return { tone: "ok", title: t("Sent for approval"), detail: t("A second person sees it in their inbox.") };
    });
  const decide = (action: "approve" | "reject") => {
    setAsking(false);
    void run(action, async () => {
      await decideWriteback(id, action);
      refresh();
      return action === "approve" ? { tone: "ok", title: t("Approved"), detail: t("The values are written to SAP next.") } : { tone: "ok", title: t("Rejected"), detail: t("Nothing is written to SAP.") };
    });
  };

  return (
    <Sec title={t("Send to SAP")}>
      {!golden ? (
        <p className="m2-rp m2-meta">{t("Promote this record to golden first. Only an approved golden record is sent to SAP.")}</p>
      ) : preview.isPending ? (
        <Skeleton width="100%" height={80} />
      ) : preview.isError ? (
        <ErrorFrame onRetry={() => void preview.refetch()}>{t("What would be sent to SAP could not be read.")}</ErrorFrame>
      ) : (
        <>
          <FactList>
            <Fact label={t("Golden fields")}>{int(Object.keys(preview.data.golden_fields).length)}</Fact>
            <Fact label={t("Systems")}>{int(preview.data.targets.length)}</Fact>
            <Fact label={t("Writes to SAP")}>{preview.data.live_enabled ? t("Switched on") : t("Switched off in this deployment")}</Fact>
          </FactList>
          {preview.data.message ? <p className="m2-prov">{preview.data.message}</p> : null}
          {preview.data.unresolved_sources.length ? <p className="m2-prov">{t("No target is known for the source records {keys}.", { keys: preview.data.unresolved_sources.join(", ") })}</p> : null}
          {preview.data.targets.map((tg) => {
            const planned = latest?.targets.find((x) => x.system_id === tg.system_id);
            const fields = planned?.fields ?? tg.fields;
            return (
              <div key={tg.system_id}>
                <p className="m2-strong">{tg.system_name ?? tg.system_id}</p>
                <p className="m2-meta">{tg.supported ? (tg.method === "rfc_bapi" ? t("Goes by BAPI {bapi}", { bapi: tg.bapi ?? "" }) : t("Goes by OData update")) : (tg.reason ?? t("This system takes no write-back."))}</p>
                <table className="m2-tbl m2-ftbl" aria-label={t("Fields sent to {system}", { system: tg.system_name ?? tg.system_id })}>
                  <thead>
                    <tr>
                      <th scope="col">{t("Field")}</th>
                      <th scope="col">{t("Golden value")}</th>
                      <th scope="col">{t("In SAP now")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f) => (
                      <tr key={f.field}>
                        <th scope="row" className="m2-fcell">
                          <Coded code={f.field} text={describeField(f.field)} />
                          <span className="m2-meta">{f.result ? (RESULT_WORD[f.result]?.() ?? f.result) : f.supported ? t("Can be written") : (f.reason ?? t("Not carried"))}</span>
                        </th>
                        <td>{show(f.golden_value)}</td>
                        <td>{f.result && f.result !== "unsupported" ? show(f.current_value) : <Dash why={t("Not read from SAP yet")} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </>
      )}

      {golden ? (
        <>
          <h4 className="m2-strong">{t("Requests")}</h4>
          {reqs.isPending ? (
            <Skeleton width="100%" height={40} />
          ) : reqs.isError ? (
            <ErrorFrame onRetry={() => void reqs.refetch()}>{t("The requests could not be read.")}</ErrorFrame>
          ) : list.length === 0 ? (
            <p className="m2-rp m2-meta">{t("Nothing has been sent to SAP for this record.")}</p>
          ) : (
            <ul className="m2-hist" aria-label={t("Write-back requests")}>
              {list.map((r) => (
                <li key={r.id}>
                  <span className="m2-d">{formatDate(r.created_at, "date")}</span>
                  <span>
                    {STATUS_WORD(r.status)}
                    {r.requested_by ? `, ${t("asked by {who}", { who: r.requested_by })}` : ""}
                    {r.approved_by ? `, ${t("approved by {who}", { who: r.approved_by })}` : ""}
                    {r.rejected_by ? `, ${t("rejected by {who}", { who: r.rejected_by })}` : ""}
                    {Object.keys(r.counts).length ? <span className="m2-meta">{t("{n} would change, {m} already the same", { n: r.counts.would_change ?? 0, m: r.counts.unchanged ?? 0 })}</span> : null}
                    {r.error ? <span className="m2-meta">{r.error}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="m2-acts">
            {canApply && !busy ? (
              <button type="button" className="m2-btn" disabled={pending !== null} onClick={check}>
                {pending === "check" ? t("Checking…") : latest ? t("Check with SAP again") : t("Check with SAP")}
              </button>
            ) : null}
            {canApply && latest?.status === "simulated" && mine && changes > 0 ? (
              <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={() => submit(latest)}>
                {pending === "submit" ? t("Sending…") : t("Send for approval")}
              </button>
            ) : null}
            {canApprove && latest?.status === "pending_approval" && !mine ? (
              <>
                <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={() => setAsking(true)}>
                  {pending === "approve" ? t("Approving…") : t("Approve")}
                </button>
                <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => decide("reject")}>
                  {pending === "reject" ? t("Rejecting…") : t("Reject")}
                </button>
              </>
            ) : null}
          </div>
          {!canApply && !canApprove ? <p className="m2-prov">{t("Checking or sending to SAP needs the apply permission, which your role does not hold.")}</p> : null}
          {latest?.status === "simulated" && changes === 0 ? <p className="m2-prov">{t("SAP already holds these values. There is nothing to send.")}</p> : null}
          {latest?.status === "pending_approval" && mine ? <p className="m2-prov">{t("You asked for this; a second person approves it.")}</p> : null}
          {outcome ? <ResultFrame outcome={outcome} /> : null}
          {asking ? (
            <Confirm
              title={t("Approve the write to SAP")}
              body={t("{n} {n, plural, one {field is} other {fields are}} written to SAP once you approve. A committed change cannot be taken back from here.", { n: changes })}
              confirm={t("Approve")}
              danger
              pending={pending === "approve"}
              onConfirm={() => decide("approve")}
              onCancel={() => setAsking(false)}
            />
          ) : null}
        </>
      ) : null}
    </Sec>
  );
}
