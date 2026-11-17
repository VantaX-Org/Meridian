"use client";

import type { WorkRow } from "@/lib/api/v2/types";
import { failureText } from "@/lib/v2/errors";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { f1, VERDICT_LABEL } from "@/lib/v2/score";
import { capWords, listWords, recordsByModule, signed1 } from "@/lib/v2/step9";
import { useSimulation } from "@/lib/v2/step9-queries";
import { ErrorState, Sheet, Skeleton } from "@/ui/kit";

/**
 * Rescores the object with the most loaded records as if those records were fixed. Read-only: POST /simulate/fix
 * changes nothing in SAP or in Meridian.
 */
export function SimulateSheet({ rows, open, onClose }: { rows: readonly WorkRow[]; open: boolean; onClose: () => void }) {
  const g = recordsByModule(rows)[0];
  const q = useSimulation(open && g ? { module: g.module, records: g.records } : null);
  const r = q.data;
  return (
    <Sheet open={open} onClose={onClose} label={t("Simulate fixing")} closeLabel={t("Close")}>
      <p className="mx-muted">{t("Simulation: nothing is changed in SAP or in Meridian.")}</p>
      {g ? <p>{t("{n} records of {object}", { n: g.records.length, object: `${moduleText(g.module)} (${g.module})` })}</p> : null}
      {q.isLoading ? <Skeleton lines={3} label={t("Running the simulation")} /> : q.isError ? <ErrorState heading={t("The simulation failed")} body={failureText(q.error)} onRetry={() => void q.refetch()} retryLabel={t("Try again")} /> : r ? (
        <dl data-testid="sim-result">
          <dt>{t("Score before")}</dt><dd>{f1(r.before.score)}</dd>
          <dt>{t("Score after, simulated")}</dt><dd>{f1(r.after.score)} ({signed1(r.delta.score)})</dd>
          <dt>{t("Cap")}</dt><dd>{capWords(r.after)}</dd>
          <dt>{t("Verdict")}</dt><dd>{r.after.verdict ? VERDICT_LABEL[r.after.verdict] : t("Not measured")}</dd>
          <dt>{t("Critical rules cleared")}</dt><dd>{r.delta.breaches_cleared.length ? listWords(r.delta.breaches_cleared) : t("None")}</dd>
        </dl>
      ) : null}
    </Sheet>
  );
}
