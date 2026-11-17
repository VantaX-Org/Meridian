"use client";

import { useQuery } from "@tanstack/react-query";
import { runPreflight, type MoveIssue, type Severity } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, EmptyState, FieldChip, SeverityPill, StatTile } from "@/ui/kit";
import { Gate } from "../common";

/** Critical and high issues are errors: they block the load. The rest are warnings. */
export const BLOCKING: Severity[] = ["critical", "high"];

const label = (s: Severity): string => ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low"), info: t("Info") })[s];

const group = (issues: MoveIssue[]) => {
  const m = new Map<string, MoveIssue[]>();
  issues.forEach((i) => m.set(i.entity, [...(m.get(i.entity) ?? []), i]));
  return [...m.entries()];
};

/** Step 4: what would go wrong, by entity. Errors stop the move; nothing is written at this step. */
export function Preflight({ planId, onBack, onNext }: { planId: string; onBack: () => void; onNext: () => void }) {
  const q = useQuery({ queryKey: ["next", "move", "preflight", planId], queryFn: () => runPreflight(planId), staleTime: 0 });
  const issues = q.data ?? [];
  const errors = issues.filter((i) => BLOCKING.includes(i.severity));

  return (
    <Gate loading={q.isLoading} error={q.isError} what={t("the checks")}>
      <div className="mx-col">
        <dl className="mx-tiles">
          <StatTile label={t("Errors")} value={errors.length} note={t("Block the load")} />
          <StatTile label={t("Warnings")} value={issues.length - errors.length} note={t("Load can go ahead")} />
        </dl>
        {errors.length ? <p className="mx-field-e" role="alert">{t("Fix the errors, then check again. The load stays locked until there are none.")}</p> : null}
        {issues.length ? group(issues).map(([entity, list]) => (
          <Card key={entity} title={entity} sub={t("{n} issues", { n: list.length })}>
            <ul className="mx-issues">
              {list.map((i, k) => (
                <li key={k}>
                  <SeverityPill sev={i.severity} label={label(i.severity)} />{" "}
                  {i.field ? <FieldChip code={i.field} /> : null} {i.reason}{" "}
                  <span className="mx-muted mx-num">{t("{n} records", { n: i.records.toLocaleString("en") })}</span>
                </li>
              ))}
            </ul>
          </Card>
        )) : <EmptyState heading={t("No issues found")} body={t("The target is ready to receive the plan.")} />}
        <div className="mx-actions">
          <Button onClick={onBack}>{t("Back")}</Button>
          <Button onClick={() => q.refetch()}>{t("Check again")}</Button>
          <Button variant="primary" disabled={errors.length > 0 || q.isFetching} onClick={onNext}>{t("Continue to load")}</Button>
        </div>
      </div>
    </Gate>
  );
}
