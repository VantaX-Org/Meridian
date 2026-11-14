"use client";

/** Fix approval, four-eyes: review, approve the batch, approve the write-back. Approvals.tsx stays as it is. */
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { approveBatch } from "@/lib/api/remediation";
import { approveWriteback } from "@/lib/api/v2/batches";
import { t } from "@/lib/v2/i18n";

export interface ApproveApi { batch: (id: string) => Promise<unknown>; writeback: (id: string) => Promise<unknown> }
const LIVE: ApproveApi = { batch: approveBatch, writeback: approveWriteback };

export function ApproveFlow({ id, summary, ownBatch, api = LIVE, onDone }: { id: string; summary: string; /** The signed-in user raised this batch. */ ownBatch?: boolean; api?: ApproveApi; onDone?: () => void }) {
  const steps: FlowStep[] = [
    { id: "review", label: t("Review"), blocked: ownBatch ? t("A second person must approve this batch.") : undefined, body: <p>{summary}</p> },
    { id: "batch", label: t("Approve the batch"), next: { label: t("Approve batch"), run: () => api.batch(id) }, body: <p>{t("Your approval is recorded under your name.")}</p> },
    { id: "writeback", label: t("Approve the write-back"), next: { label: t("Approve write-back"), run: () => api.writeback(id) }, body: <p>{t("The approved values can now go to the system.")}</p> },
  ];
  return <StepFlow steps={steps} label={t("Approve a fix")} onFinish={onDone} />;
}
