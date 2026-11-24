"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useToast } from "@/ui/kit/Toast";
import { postUndo } from "@/lib/api/v2/work";
import { pushAction } from "@/lib/v2/undo";
import { t } from "@/lib/v2/i18n";

export interface OptimisticOptions<Vars, Res extends { action_id?: string | null }, Cache> {
  /** The call to the server. */
  mutationFn: (vars: Vars) => Promise<Res>;
  /** The query whose cached data is patched at once. */
  queryKey: QueryKey;
  /** Returns the cache as it will be once the call succeeds. */
  patch: (current: Cache | undefined, vars: Vars) => Cache | undefined;
  /** What was done, in a short sentence: "Accepted 3 suggested values". Shown in the undo toast. */
  label: (vars: Vars, res: Res) => string;
}

/**
 * A TanStack mutation that patches the cache first, rolls back and says so if the call fails, and offers Undo
 * (button and Ctrl or Cmd Z) when the response carries an `action_id`. Every decide, accept, reject and edit goes through here.
 */
export function useOptimistic<Vars, Res extends { action_id?: string | null }, Cache>(o: OptimisticOptions<Vars, Res, Cache>) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<Res, Error, Vars, { prev: Cache | undefined }>({
    mutationFn: o.mutationFn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: o.queryKey });
      const prev = qc.getQueryData<Cache>(o.queryKey);
      qc.setQueryData<Cache | undefined>(o.queryKey, (cur) => o.patch(cur, vars));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      qc.setQueryData(o.queryKey, ctx?.prev);
      toast(t("That did not save. Your change was put back."), "bad");
    },
    onSuccess: (res, vars) => {
      const label = o.label(vars, res);
      const id = res.action_id;
      if (!id) { toast(label, "good"); return; }
      pushAction({ ids: [id], label });
      toast(label, "good", {
        ms: 10000,
        action: {
          label: t("Undo"),
          undo: true,
          onAction: () => { void postUndo(id).then(() => qc.invalidateQueries({ queryKey: o.queryKey })); },
        },
      });
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: o.queryKey }); },
  });
}
