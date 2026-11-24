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
    <nav className="mx-fixrail" aria-label={t("Rules over tolerance")} data-testid="rule-rail">
      <h2 className="mx-fixrail-t">{t("Rules over tolerance")}</h2>
      {q.isPending ? <Skeleton label={t("Loading")} /> : q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : !rules.length ? <EmptyState heading={t("No rule has open work.")} /> : (
        <ul className="mx-fixrail-l">
          {rules.map((g, i) => {
            const on = picked === g.check_id;
            const done = decided.get(g.check_id) ?? 0;
            const pct = g.population ? Math.min(100, (g.records / g.population) * 100) : null;
            return (
              <li key={g.check_id}>
                <button type="button" className="mx-fixrule" aria-pressed={on} data-top={picked === null && i === 0 ? "" : undefined} data-sev={sevOf(g.severity)} onClick={() => onPick(on ? null : g.check_id)}>
                  <span className="mx-fixrule-h">
                    <span className="mx-fixrule-sq" role="img" aria-label={sevLabel(g.severity)} />
                    <code className="mx-code">{g.check_id}</code>
                    <span className="mx-fixrule-t">{g.message ?? ""}</span>
                    <span className="mx-fixrule-c mx-num">{g.records}</span>
                  </span>
                  {pct !== null ? <span className="mx-fixrule-bar" aria-hidden="true"><i style={{ inlineSize: `${pct}%` }} /></span> : null}
                  <span className="mx-fixrule-n mx-muted">
                    {g.field ? <>{g.field}, </> : null}{t("{n} proposed", { n: g.proposed })}
                    {done ? <>, <b>{t("{n} decided", { n: done })}</b></> : null}
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
