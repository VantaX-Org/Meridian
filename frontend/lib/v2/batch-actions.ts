"use client";

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/design/v2/Toast";
import { sendBatchToSap, type SendResult } from "@/lib/api/v2/batches";
import { postApproveBatch, postSendBack } from "@/lib/api/v2/work";
import { useV2Session } from "./hooks";
import { refreshV2 } from "./queries";
import { useWorkCan } from "./work-actions";
import { clearPatches } from "./work-overrides";
import { t } from "@/lib/v2/i18n";

export interface BatchCan {
  approve: boolean;
  /** Send an approved batch to SAP: the export permission. */
  send: boolean;
  /** Reassign work: the assign permission. */
  assign: boolean;
  apply: boolean;
  /** The signed-in user, for four eyes. */
  me: string | null;
}

/** What this person may do with a batch, from the permissions the API grants (fixture mode: everything, or `?role=`). */
export function useBatchCan(): BatchCan {
  const session = useV2Session();
  const wc = useWorkCan();
  return useMemo(() => ({ approve: wc.approve, assign: wc.assign, apply: wc.apply, send: wc.mode !== "viewer" && session.can("export"), me: session.id }), [wc.approve, wc.assign, wc.apply, wc.mode, session]);
}

/**
 * The three things a person does to a batch. Each calls the API, refetches every v2 read that shows the change, and
 * throws the API's own sentence on a refusal, so the caller decides where to show it (a notice, or the inspector's frame).
 * Approve and send back post a notice with Undo; sending to SAP cannot be taken back.
 */
export function useBatchActions() {
  const qc = useQueryClient();
  const toast = useToast();

  const settle = useCallback(async () => {
    await refreshV2(qc);
    clearPatches();
  }, [qc]);

  const approve = useCallback(
    async (id: string, label: string) => {
      const r = await postApproveBatch(id);
      const text = t("Approved batch {label}", { label });
      if (r.action_id) toast.done({ ids: [r.action_id], label: text });
      else toast.show(text);
      await settle();
      return r;
    },
    [settle, toast],
  );

  const sendBack = useCallback(
    async (id: string, label: string, note: string) => {
      const r = await postSendBack(id, note);
      const text = t("Sent batch {label} back", { label });
      if (r.action_id) toast.done({ ids: [r.action_id], label: text });
      else toast.show(text);
      await settle();
      return r;
    },
    [settle, toast],
  );

  const sendToSap = useCallback(
    async (id: string, records: number | null): Promise<SendResult> => {
      const r = await sendBatchToSap(id, records);
      await settle();
      return r;
    },
    [settle],
  );

  return { approve, sendBack, sendToSap };
}
