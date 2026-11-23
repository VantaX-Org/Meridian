"use client";

import { useMemo } from "react";
import type { WorkGroup } from "@/lib/api/v2/work";
import { t } from "@/lib/v2/i18n";
import { useWorkGroups } from "@/lib/v2/work-queries";
import { EmptyState, ErrorState, Skeleton } from "@/ui/kit";
import { sevLabel, sevOf } from "../shared";

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Capping rules first, then by how many records fail. */
export const orderRules = (gs: WorkGroup[]): WorkGroup[] =>
  [...gs].sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.records - a.records);

/** The rules of the object, with how many of their records are decided. Picking one filters the grid. */
export function RuleRail({ module, severity, picked, onPick, decided }: {
  module: string | null; severity?: string; picked: string | null; onPick: (id: string | null) => void; decided: Map<string, number>;
}) {
  const q = useWorkGroups({ module: module ?? undefined, severity: severity }, true);
  const rules = useMemo(() => orderRules(q.data?.groups ?? []), [q.data]);
  return (
    <nav className="mx-fixrail" aria-label={t("Rules with work")} data-testid="rule-rail">
      <h2 className="mx-card-t">{t("Rules with work")}</h2>
      {q.isPending ? <Skeleton label={t("Loading")} /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : !rules.length ? <EmptyState heading={t("No rule has open work.")} /> : (
        <ul className="mx-list">
          {rules.map((g) => {
            const on = picked === g.check_id;
            const done = decided.get(g.check_id) ?? 0;
            return (
              <li key={g.check_id}>
                <button type="button" className="mx-fixrule" aria-pressed={on} data-sev={sevOf(g.severity)} onClick={() => onPick(on ? null : g.check_id)}>
                  <span className="mx-fixrule-h"><code className="mx-code">{g.check_id}</code><span className="mx-sev">{sevLabel(g.severity)}</span></span>
                  <span className="mx-fixrule-t">{g.message ?? ""}</span>
                  <span className="mx-fixrule-n mx-muted">
                    {t("{n} records", { n: g.records })}
                    {done ? <>{" "}<b>{t("{n} decided", { n: done })}</b></> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
