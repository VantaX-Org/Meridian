"use client";

import { useMemo, useState } from "react";
import type { InfiniteData } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import type { WorkPage, WorkRow } from "@/lib/api/v2/types";
import { postDecide, type DecideResult } from "@/lib/api/v2/work";
import { t } from "@/lib/v2/i18n";
import { useOptimistic } from "@/lib/v2/optimistic";
import { SERVER_SORT, filtersOf, type LedgerState } from "@/lib/v2/work";
import { useWorkRows, workKeys } from "@/lib/v2/work-queries";
import { decided, inChip, inScope, rowId } from "./fixlib";

export type FixAction = "accept" | "edit" | "reject";
export interface FixVars { action: FixAction; rows: WorkRow[]; value?: string; reason?: { id: string; label: string } }
type Cache = InfiniteData<WorkPage, string | undefined>;

/** Fixed and Exceptions are not open rows, so they read their own query and are not patched. */
const readOnlyChip = (s: LedgerState) => s.chip === "fixed" || s.chip === "exceptions";

const LABEL: Record<FixAction, (n: number) => string> = {
  accept: (n) => t("{n, plural, one {# fix accepted} other {# fixes accepted}}", { n }),
  edit: (n) => t("{n, plural, one {# value changed} other {# values changed}}", { n }),
  reject: (n) => t("{n, plural, one {# fix rejected} other {# fixes rejected}}", { n }),
};

/**
 * The fix screen's rows: one open-status list that every chip filters on the client, so a decided row stays where it is and
 * changes state. Decisions patch that list before the server answers and roll back when it refuses.
 */
export function useFixData(state: LedgerState) {
  const fx = useFixture();
  const readOnly = readOnlyChip(state);
  const filters = useMemo(() => (readOnly ? filtersOf(state) : filtersOf({ ...state, chip: null, seg: null })), [state, readOnly]);
  const q = useWorkRows(filters, state.sort);
  const all = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const rows = useMemo(() => all.filter((r) => inScope(r, state, null) && (readOnly || inChip(r, state.chip))), [all, state, readOnly]);

  const [batchId, setBatchId] = useState<string | null>(null);
  const decide = useOptimistic<FixVars, DecideResult, Cache>({
    queryKey: workKeys.rows(fx, filters, SERVER_SORT[state.sort]),
    mutationFn: async (v) => { const res = await postDecide(v.rows.map((r) => ({
      module: r.module, record_key: r.record_key,
      check_id: (state.rule ? r.checks.find((c) => state.rule!.split(",").includes(c)) : undefined) ?? r.checks[0],
      action: v.action === "reject" ? "not_an_issue" : v.action,
      value: v.action === "edit" ? v.value : undefined,
      note: v.action === "reject" ? v.reason?.label : undefined,
    })), v.rows[0]?.version_id); if (res.draft_batch_id) setBatchId(res.draft_batch_id); return res; },
    patch: (cur, v) => {
      if (!cur) return cur;
      const ids = new Set(v.rows.map(rowId));
      return { ...cur, pages: cur.pages.map((p) => ({ ...p, items: p.items.flatMap((r) => (ids.has(rowId(r)) ? decided(r, v.action, v.value) ?? [] : [r])) })) };
    },
    label: (v) => LABEL[v.action](v.rows.length),
  });
  return { q, all, rows, decide, readOnly, batchId };
}
