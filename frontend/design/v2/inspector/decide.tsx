"use client";

import "../roles.css";
import "../system.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { decideTask } from "@/lib/api/v2/requests";
import { useMyTasks, useWorkflowInstance } from "@/lib/v2/requests-queries";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { t as tr } from "@/lib/v2/i18n";
import { Actions } from "../Inspector";
import { ResultFrame, useOutcome, WorkflowSteps } from "./shared";

/** The approval run behind a step: every step with who decided it, then the audit trail. */
function ApprovalDetail({ instanceId }: { instanceId: string }) {
  const q = useWorkflowInstance(instanceId, true);
  if (q.isError) return <ErrorFrame>{tr("The approval detail could not be read.")}</ErrorFrame>;
  if (!q.data) return <Skeleton width="60%" height={12} />;
  const { tasks, history } = q.data;
  return (
    <div data-testid="approval-detail">
      <h4>{tr("Approval steps")}</h4>
      {tasks.length ? <WorkflowSteps tasks={tasks} testId="approval-steps" /> : <EmptyFrame>{tr("This approval has no steps yet.")}</EmptyFrame>}
      <h4>{tr("Audit trail")}</h4>
      {history.length ? (
        <ol className="m2-trail" data-testid="approval-trail">
          {history.map((h) => (
            <li key={h.id}>
              <div>
                {h.action.replace(/_/g, " ")}
                {h.actor_label ? tr(" by {user}", { user: h.actor_label }) : ""}
              </div>
              {h.detail && typeof h.detail.reason === "string" ? <p className="m2-tr-note">{h.detail.reason}</p> : null}
              {h.detail && typeof h.detail.comment === "string" ? <p className="m2-tr-note">{h.detail.comment}</p> : null}
              <div className="m2-tr-at">{formatDate(h.created_at, "datetime")}</div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyFrame>{tr("Nothing has happened to this approval yet.")}</EmptyFrame>
      )}
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
  const { outcome, pending, run } = useOutcome(`decide:${kind}:${id}`);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [detail, setDetail] = useState(false);
  const task = (q.data?.items ?? []).find((x) => x.object_id === id && x.may_decide);
  if (!task) return outcome ? <ResultFrame outcome={outcome} /> : null;
  const decide = (decision: "approve" | "reject") =>
    run(decision, async () => {
      await decideTask(task.id, decision, decision === "reject" ? reason.trim() : undefined);
      await qc.invalidateQueries({ queryKey: ["v2"] });
      return { tone: "ok", title: decision === "approve" ? tr("You approved {step}.", { step: task.step_name }) : tr("You rejected {step}.", { step: task.step_name }) };
    });
  return (
    <section className="m2-rsec" aria-label={tr("Your decision")} data-testid="step-decide">
      <h3>{tr("Your decision")}</h3>
      <p className="m2-prov">
        {task.due_at ? tr("{step} waits for you, due {due}.", { step: task.step_name, due: formatDate(task.due_at, "datetime") }) : tr("{step} waits for you.", { step: task.step_name })}
        {task.on_behalf_of ? tr(" You decide on behalf of {who}.", { who: task.on_behalf_of }) : ""}
      </p>
      {rejecting ? (
        <div className="m2-compose">
          <label className="m2-fld m2-wide">
            <span className="m2-lbl">{tr("Why you reject it")}</span>
            <textarea rows={2} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
      ) : null}
      <Actions>
        {rejecting ? (
          <>
            <button type="button" className="m2-btn m2-btn-primary" disabled={pending !== null || !reason.trim()} onClick={() => void decide("reject")}>
              {tr("Reject")}
            </button>
            <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => setRejecting(false)}>
              {tr("Cancel")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="m2-btn m2-btn-primary" disabled={pending !== null} onClick={() => void decide("approve")}>
              {tr("Approve")}
            </button>
            <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => setRejecting(true)}>
              {tr("Reject")}
            </button>
          </>
        )}
      </Actions>
      <button type="button" className="m2-btn m2-sm" aria-expanded={detail} onClick={() => setDetail((v) => !v)}>
        {detail ? tr("Hide approval detail") : tr("Show approval detail")}
      </button>
      {detail ? <ApprovalDetail instanceId={task.instance_id} /> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </section>
  );
}
