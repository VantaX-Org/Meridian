/**
 * The four-eyes approval of one load. Whoever prepared the run has given the first approval; someone else gives the
 * second here. The decision is held on the server, which refuses the preparer and a second decision.
 */
import { useState } from "react";
import { useDecideLoad, useLoadApproval } from "@/lib/api/next/load";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, ErrorState, Skeleton } from "../kit";
import { canReject, loadBlock, loadReason, secondBlock, secondReason } from "./approval";
import { Denied, useGuard } from "./states";

const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "");

export function ApprovePanel({ runId }: { runId: string }) {
  const session = useV2Session();
  const q = useLoadApproval(runId);
  const decide = useDecideLoad(runId);
  const guard = useGuard();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const state = q.data ?? null;

  if (!session.can("approve")) return <Denied right={t("approve")} />;
  if (q.isLoading) return <Skeleton lines={3} label={t("Loading the approvals")} />;
  if (q.isError || !state) return <ErrorState sentence={t("The approvals could not be loaded.")} error={q.error} onRetry={() => void q.refetch()} />;
  const send = (v: { decision: "approved" | "rejected"; comment?: string }) =>
    guard.run(async () => {
      setRefused(null);
      try { await decide.mutateAsync(v); } catch (e) { setRefused(e instanceof Error && e.message ? e.message : t("The server refused this decision.")); }
    });
  const second = () => send({ decision: "approved" });
  const reject = () => { if (canReject(comment)) void send({ decision: "rejected", comment: comment.trim() }); };
  const block = secondBlock(state, session.id || null);

  return (
    <section className="nx-ld-step" data-testid="approve" aria-label={t("Approvals")}>
      <p className="nx-ld-lede">{t("Two people approve a load: the person who prepared it, then someone else. The load stays off until both have.")}</p>
      <ul className="nx-ld-people" data-testid="approve-people">
        <li data-testid="approve-first">
          <strong>{t("First approval")}</strong>
          {state.first ? <><span>{state.first.name}</span><time dateTime={state.first.at}>{when(state.first.at)}</time></> : <Chip tone="neutral">{t("Waiting")}</Chip>}
        </li>
        <li data-testid="approve-second">
          <strong>{t("Second approval")}</strong>
          {state.second ? <><span>{state.second.name}</span><time dateTime={state.second.at}>{when(state.second.at)}</time></> : <Chip tone="neutral">{t("Waiting")}</Chip>}
        </li>
        {state.rejected ? (
          <li data-testid="approve-rejected">
            <strong>{t("Rejected")}</strong><span>{state.rejected.name}</span><time dateTime={state.rejected.at}>{when(state.rejected.at)}</time>
            <span>{state.rejected.comment}</span>
          </li>
        ) : null}
      </ul>

      {block === null ? (
        <div className="nx-ld-actions">
          <Button variant="primary" loading={guard.busy} loadingLabel={t("Saving")} onClick={() => void second()}>{t("Give the second approval")}</Button>
          <Button variant="secondary" onClick={() => setRejecting((v) => !v)}>{t("Reject")}</Button>
        </div>
      ) : (
        <p role="status" data-testid="approve-blocked">{secondReason(block)}</p>
      )}

      {rejecting && !state.rejected ? (
        <div className="nx-ld-fields">
          <label className="nx-field-label">
            {t("Why do you reject this load?")}
            <textarea className="nx-ld-comment" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="reject-comment" />
          </label>
          <Button variant="primary" disabled={!canReject(comment)} reason={canReject(comment) ? undefined : t("Write the reason first.")} loading={guard.busy} onClick={reject}>{t("Reject the load")}</Button>
        </div>
      ) : null}
      {refused ? <p role="alert" className="nx-ld-meta" data-testid="approve-refused">{refused}</p> : null}
      {loadBlock(state) ? <p className="nx-ld-meta" data-testid="load-reason">{loadReason(state)}</p> : null}
    </section>
  );
}
