"use client";

import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { errorSentence } from "@/lib/api/v2/client";
import { useDecide, type RequestDetail } from "@/lib/api/next/approvals";
import { Button, Chip, Confirm, useToast } from "../kit";

const STATE_TONE = { pending: "warn", approved: "good", rejected: "bad", dry_run: "neutral" } as const;
export const stateLabel = (s: RequestDetail["state"]) => (s === "pending" ? t("Waiting for a second person") : s === "approved" ? t("Approved") : s === "rejected" ? t("Rejected") : t("Dry run"));

/** Who asked, who may decide, and the two decisions. The server says whether this viewer may decide. */
export function DecisionPanel({ req }: { req: RequestDetail }) {
  const decide = useDecide();
  const toast = useToast();
  const [ask, setAsk] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const n = req.changes.length;

  const run = (reject?: string) => {
    setAsk(null);
    decide.mutate({ id: req.id, reject }, {
      onSuccess: () => toast({ tone: "good", text: reject === undefined ? t("Approved. {n} changes sent for writing.", { n }) : t("Rejected. Nothing was written.") }),
      onError: (e) => toast({ tone: "bad", text: errorSentence(e, t("The decision could not be saved.")) }),
    });
  };

  return (
    <section className="nx-card nx-ap-decide" aria-labelledby="ap-decide-h" data-testid="decision-panel">
      <h2 id="ap-decide-h">{t("Approval")}</h2>
      <p><Chip tone={STATE_TONE[req.state]}>{stateLabel(req.state)}</Chip></p>
      <dl className="nx-ap-facts">
        <dt>{t("Requested by")}</dt><dd>{req.requested_by_name ?? t("Unknown")}</dd>
        {req.state === "pending" ? <><dt>{t("Can approve")}</dt><dd>{req.approvers.length ? req.approvers.join(", ") : t("Nobody else holds the approve permission yet.")}</dd></> : null}
        {req.state === "approved" ? <><dt>{t("Approved by")}</dt><dd>{req.approved_by_name ?? t("Unknown")}</dd></> : null}
        {req.state === "rejected" ? <><dt>{t("Rejected by")}</dt><dd>{req.rejected_by_name ?? t("Unknown")}</dd>{req.reject_reason ? <><dt>{t("Reason")}</dt><dd>{req.reject_reason}</dd></> : null}</> : null}
      </dl>
      {req.is_requester && req.state === "pending" ? <p role="note" className="nx-ap-note">{t("You made this request. A second person must approve or reject it.")}</p> : null}
      {req.cannot_decide_reason === "no_permission" ? <p role="note" className="nx-ap-note">{t("You do not hold the approve permission.")}</p> : null}
      {req.can_decide ? (
        <div className="nx-ap-actions">
          <Button variant="primary" onClick={() => setAsk("approve")} disabled={decide.isPending}>{t("Approve")}</Button>
          <Button variant="secondary" onClick={() => setAsk("reject")} disabled={decide.isPending}>{t("Reject")}</Button>
        </div>
      ) : null}
      <p className="nx-ap-note" data-testid="undo-note">{req.undo_note}</p>
      <Confirm
        open={ask === "approve"}
        title={t("Approve this write-back?")}
        consequence={t("This sends {n} changes to be written. SAP's previous values are not stored, so it cannot be reversed here.", { n })}
        confirmLabel={t("Approve")}
        danger
        onConfirm={() => run()}
        onCancel={() => setAsk(null)}
      />
      <Confirm
        open={ask === "reject"}
        title={t("Reject this write-back?")}
        consequence={
          <label className="nx-field">
            <span>{t("Reason")}</span>
            <input className="nx-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </label>
        }
        confirmLabel={t("Reject")}
        blocked={reason.trim() ? undefined : t("Give a reason first")}
        onConfirm={() => run(reason.trim())}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}
