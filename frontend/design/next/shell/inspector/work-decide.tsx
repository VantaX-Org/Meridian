"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { decideTask } from "@/lib/api/v2/requests";
import { useMyTasks, useWorkflowInstance } from "@/lib/v2/requests-queries";
import { t } from "@/lib/v2/i18n";
import { Button, ErrorState, Skeleton } from "../../kit";
import { Actions } from "./frame";
import { Note, OutcomeLine, WorkflowSteps, useOutcome } from "./work-common";

/** An audit trail entry: the action, who did it, the reason or comment it carried, and when. */
export interface TrailEntry {
  id: string;
  action: string;
  actor_label?: string | null;
  detail?: Record<string, unknown> | null;
  created_at: string;
}

/** The audit trail of a request or an approval, newest as the API sends it. */
export function Trail({ items, testId }: { items: TrailEntry[]; testId: string }) {
  return (
    <ol className="nx-ib-list" data-testid={testId}>
      {items.map((h) => (
        <li key={h.id}>
          <div>
            {h.action.replace(/_/g, " ")}
            {h.actor_label ? t(" by {user}", { user: h.actor_label }) : ""}
          </div>
          {h.detail && typeof h.detail.reason === "string" ? <p className="nx-wk-quote">{h.detail.reason}</p> : null}
          {h.detail && typeof h.detail.comment === "string" ? <p className="nx-wk-quote">{h.detail.comment}</p> : null}
          <div className="nx-ib-meta">{formatDate(h.created_at, "datetime")}</div>
        </li>
      ))}
    </ol>
  );
}

/** The approval run behind a step: every step with who decided it, then the audit trail. */
function ApprovalDetail({ instanceId }: { instanceId: string }) {
  const q = useWorkflowInstance(instanceId, true);
  if (q.isError) return <ErrorState sentence={t("The approval detail could not be read.")} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={2} label={t("Approval steps")} />;
  const { tasks, history } = q.data;
  return (
    <div data-testid="approval-detail">
      <h4>{t("Approval steps")}</h4>
      {tasks.length ? <WorkflowSteps tasks={tasks} testId="approval-steps" /> : <Note>{t("This approval has no steps yet.")}</Note>}
      <h4>{t("Audit trail")}</h4>
      {history.length ? <Trail items={history} testId="approval-trail" /> : <Note>{t("Nothing has happened to this approval yet.")}</Note>}
    </div>
  );
}

/**
 * The workflow step waiting for this person on one object (a fix batch or a change request): its name and due time,
 * Approve, and Reject with a reason. Draws nothing when no step of this object waits for them.
 */
export function StepDecide({ kind, id }: { kind: "fix_batch" | "change_request"; id: string }) {
  const q = useMyTasks(kind);
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome();
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [detail, setDetail] = useState(false);
  const task = (q.data?.items ?? []).find((x) => x.object_id === id && x.may_decide);
  if (!task) return outcome ? <OutcomeLine outcome={outcome} /> : null;
  const decide = (decision: "approve" | "reject") =>
    run(decision, async () => {
      await decideTask(task.id, decision, decision === "reject" ? reason.trim() : undefined);
      await qc.invalidateQueries({ queryKey: ["v2"] });
      return { tone: "ok", title: decision === "approve" ? t("You approved {step}.", { step: task.step_name }) : t("You rejected {step}.", { step: task.step_name }) };
    });
  return (
    <section className="nx-ib-sec" aria-label={t("Your decision")} data-testid="step-decide">
      <h3>{t("Your decision")}</h3>
      <Note>
        {task.due_at ? t("{step} waits for you, due {due}.", { step: task.step_name, due: formatDate(task.due_at, "datetime") }) : t("{step} waits for you.", { step: task.step_name })}
        {task.on_behalf_of ? t(" You decide on behalf of {who}.", { who: task.on_behalf_of }) : ""}
      </Note>
      {rejecting ? (
        <label className="nx-wk-form">
          <span>{t("Why you reject it")}</span>
          <textarea rows={2} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
        </label>
      ) : null}
      <Actions>
        {rejecting ? (
          <>
            <Button variant="primary" disabled={pending !== null || !reason.trim()} loading={pending === "reject"} onClick={() => void decide("reject")}>
              {t("Reject")}
            </Button>
            <Button disabled={pending !== null} onClick={() => setRejecting(false)}>
              {t("Cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" disabled={pending !== null} loading={pending === "approve"} onClick={() => void decide("approve")}>
              {t("Approve")}
            </Button>
            <Button disabled={pending !== null} onClick={() => setRejecting(true)}>
              {t("Reject")}
            </Button>
          </>
        )}
      </Actions>
      <Button variant="quiet" size={32} aria-expanded={detail} onClick={() => setDetail((v) => !v)}>
        {detail ? t("Hide approval detail") : t("Show approval detail")}
      </Button>
      {detail ? <ApprovalDetail instanceId={task.instance_id} /> : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </section>
  );
}
