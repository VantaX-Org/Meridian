"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moveKeys, runPreflight, usePlan, type MoveIssue, type Severity } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, EmptyState, FieldChip, SeverityPill, StatTile } from "@/ui/kit";
import { Gate } from "../common";

const label = (s: Severity): string => (s === "error" ? t("Error") : t("Warning"));

const group = (issues: MoveIssue[]) => {
  const m = new Map<string, MoveIssue[]>();
  issues.forEach((i) => { const k = i.entity ?? t("Target system"); m.set(k, [...(m.get(k) ?? []), i]); });
  return [...m.entries()];
};

/** Step 4: what would go wrong, by entity. Queued on the server; the plan is read until the check is done. Errors stop the move. */
export function Preflight({ planId, onBack, onNext }: { planId: string; onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient();
  const q = usePlan(planId);
  const start = useMutation({ mutationFn: () => runPreflight(planId), onSuccess: () => qc.invalidateQueries({ queryKey: moveKeys.plan(planId) }) });
  const asked = useRef(false);
  useEffect(() => { if (!asked.current) { asked.current = true; start.mutate(); } }, [start]);

  const pre = q.data?.preflight;
  const checking = !pre || pre.status === "queued";
  const issues = pre?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");

  return (
    <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the checks")}>
      <div className="mx-col">
        {checking ? <p className="mx-muted" role="status">{t("Checking the target. This page updates by itself.")}</p> : (
          <>
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
                      <SeverityPill sev={i.severity === "error" ? "critical" : "medium"} label={label(i.severity)} />{" "}
                      {i.field ? <FieldChip code={i.field} /> : null} {i.reason}{" "}
                      {i.records.length ? <span className="mx-muted mx-num">{t("{n} records, for example {ids}", { n: i.records.length.toLocaleString("en"), ids: i.records.slice(0, 3).join(", ") })}</span> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            )) : <EmptyState heading={t("No issues found")} body={t("The target is ready to receive the plan.")} />}
          </>
        )}
        {start.isError ? <p className="mx-field-e" role="alert">{t("The check could not start.")}</p> : null}
        <div className="mx-actions">
          <Button onClick={onBack}>{t("Back")}</Button>
          <Button disabled={checking} onClick={() => start.mutate()}>{t("Check again")}</Button>
          <Button variant="primary" disabled={checking || errors.length > 0} onClick={onNext}>{t("Continue to load")}</Button>
        </div>
      </div>
    </Gate>
  );
}
