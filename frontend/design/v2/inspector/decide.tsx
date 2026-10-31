"use client";

import "../roles.css";
import "../system.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { decideTask } from "@/lib/api/v2/requests";
import { useMyTasks } from "@/lib/v2/requests-queries";
import { t as tr } from "@/lib/v2/i18n";
import { Actions } from "../Inspector";
import { ResultFrame, useOutcome } from "./shared";

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
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </section>
  );
}
