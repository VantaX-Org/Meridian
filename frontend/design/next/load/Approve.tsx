"use client";

/** The four-eyes approval of one load. The preparer gives the first approval; someone else gives the second. */
import { useEffect, useState } from "react";
import { readApproval, writeApproval, type ApprovalState } from "@/lib/api/next/load";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip } from "../kit";
import { canReject, loadBlock, loadReason, secondBlock, secondReason } from "./approval";
import { Denied, useGuard } from "./states";

const when = (iso: string) => new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

export function useApproval(runId: string) {
  const [snap, setSnap] = useState<{ runId: string; state: ApprovalState | null }>(() => ({ runId, state: readApproval(runId) }));
  if (snap.runId !== runId) setSnap({ runId, state: readApproval(runId) });
  const state = snap.runId === runId ? snap.state : readApproval(runId);
  const save = (s: ApprovalState | null) => { writeApproval(runId, s); setSnap({ runId, state: s }); };
  return { state, save, loaded: true };
}

export function ApprovePanel({ runId, onState }: { runId: string; onState?: (s: ApprovalState | null) => void }) {
  const session = useV2Session();
  const { state, save, loaded } = useApproval(runId);
  const guard = useGuard();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  useEffect(() => { if (loaded) onState?.(state); }, [state, loaded, onState]);

  if (!session.can("approve")) return <Denied right={t("approve")} />;
  const me = { id: session.id ?? "", name: session.name ?? "" };
  const stamp = () => ({ id: me.id, name: me.name, at: new Date().toISOString() });

  const first = () => guard.run(async () => save({ preparer: { id: me.id, name: me.name }, first: stamp() }));
  const second = () => guard.run(async () => state && save({ ...state, second: stamp() }));
  const reject = () => guard.run(async () => { if (state && canReject(comment)) save({ ...state, rejected: { ...stamp(), comment: comment.trim() } }); });
  const block = state ? secondBlock(state, me.id || null) : null;

  return (
    <section className="nx-ld-step" data-testid="approve" aria-label={t("Approvals")}>
      <p className="nx-ld-lede">{t("Two people approve a load: the person who prepared it, then someone else. The load stays off until both have.")}</p>
      <ul className="nx-ld-people" data-testid="approve-people">
        <li data-testid="approve-first">
          <strong>{t("First approval")}</strong>
          {state?.first ? <><span>{state.first.name}</span><time dateTime={state.first.at}>{when(state.first.at)}</time></> : <Chip tone="neutral">{t("Waiting")}</Chip>}
        </li>
        <li data-testid="approve-second">
          <strong>{t("Second approval")}</strong>
          {state?.second ? <><span>{state.second.name}</span><time dateTime={state.second.at}>{when(state.second.at)}</time></> : <Chip tone="neutral">{t("Waiting")}</Chip>}
        </li>
        {state?.rejected ? (
          <li data-testid="approve-rejected">
            <strong>{t("Rejected")}</strong><span>{state.rejected.name}</span><time dateTime={state.rejected.at}>{when(state.rejected.at)}</time>
            <span>{state.rejected.comment}</span>
          </li>
        ) : null}
      </ul>

      {!state ? (
        <Button variant="primary" loading={guard.busy} loadingLabel={t("Saving")} onClick={() => void first()}>{t("Give the first approval")}</Button>
      ) : block === null ? (
        <div className="nx-ld-actions">
          <Button variant="primary" loading={guard.busy} loadingLabel={t("Saving")} onClick={() => void second()}>{t("Give the second approval")}</Button>
          <Button variant="secondary" onClick={() => setRejecting((v) => !v)}>{t("Reject")}</Button>
        </div>
      ) : (
        <p role="status" data-testid="approve-blocked">{secondReason(block)}</p>
      )}

      {rejecting && state && !state.rejected ? (
        <div className="nx-ld-fields">
          <label className="nx-field-label">
            {t("Why do you reject this load?")}
            <textarea className="nx-ld-comment" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="reject-comment" />
          </label>
          <Button variant="primary" disabled={!canReject(comment)} reason={canReject(comment) ? undefined : t("Write the reason first.")} loading={guard.busy} onClick={() => void reject()}>{t("Reject the load")}</Button>
        </div>
      ) : null}
      {state && loadBlock(state) ? <p className="nx-ld-meta" data-testid="load-reason">{loadReason(state)}</p> : null}
    </section>
  );
}
