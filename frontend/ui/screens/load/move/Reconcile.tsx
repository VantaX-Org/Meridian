"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { startReconcile, useReconciliation, type ReconEntity, type Reconciliation } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, DataTable, DqsPair, EmptyState, FieldChip, type Column } from "@/ui/kit";
import { Gate } from "../common";
import { CountsChart } from "./charts";

const num = (n: number) => n.toLocaleString("en");

const cols = (): Column<ReconEntity>[] => [
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} />, sort: (r) => r.entity },
  { key: "source_rows", label: t("Source rows"), align: "end", render: (r) => <span className="mx-num">{num(r.source_rows)}</span>, sort: (r) => r.source_rows },
  { key: "target_rows", label: t("Target rows"), align: "end", render: (r) => <span className="mx-num">{num(r.target_rows)}</span>, sort: (r) => r.target_rows },
  { key: "missing_in_target", label: t("Missing in target"), align: "end", render: (r) => <span className="mx-num">{num(r.missing_in_target)}</span>, sort: (r) => r.missing_in_target },
  { key: "extra_in_target", label: t("Extra in target"), align: "end", render: (r) => <span className="mx-num">{num(r.extra_in_target)}</span>, sort: (r) => r.extra_in_target },
  { key: "field_diffs", label: t("Field differences"), align: "end", render: (r) => <span className="mx-num">{num(r.field_diffs)}</span>, sort: (r) => r.field_diffs },
];

export const reasons = (d: Reconciliation["dqs"]) =>
  d.reasons.map((x) => (typeof x === "string" ? { label: x, value: "" } : { label: x.label ?? x.reason ?? "", value: x.value === undefined ? (x.label && x.reason ? x.reason : "") : String(x.value) }));

/** Step 6: counts source against target, the rows that differ, and the three quality scores with why they differ. */
export function Reconcile({ planId, onBack, onNext }: { planId: string; onBack: () => void; onNext: () => void }) {
  const [id, setId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const start = useMutation({ mutationFn: () => startReconcile(planId), onSuccess: (x) => setId(x.id) });
  const q = useReconciliation(id);
  const d = q.data;
  const sel = d?.entities.find((e) => e.entity === pick);
  const keys = sel?.sample.length ? Object.keys(sel.sample[0]) : [];

  return (
    <div className="mx-col">
      {!id ? (
        <Card title={t("Compare the two systems")} sub={t("Counts every entity in the source and in the target and lists what differs.")}>
          <div className="mx-actions">
            <Button onClick={onBack}>{t("Back")}</Button>
            <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? t("Comparing") : t("Reconcile now")}</Button>
          </div>
          {start.isError ? <p className="mx-field-e" role="alert">{t("The comparison could not start.")}</p> : null}
        </Card>
      ) : (
        <Gate loading={q.isLoading} error={q.isError} what={t("the comparison")}>
          {d ? (
            <>
              <Card title={t("Data quality score")} sub={t("The score before the move, what it should be after, and what it is.")}>
                <DqsPair
                  naLabel={t("n/a")}
                  rows={[
                    { key: "source", label: t("Source"), value: d.dqs.source },
                    { key: "projected", label: t("Projected target"), value: d.dqs.projected_target },
                    { key: "actual", label: t("Actual target"), value: d.dqs.actual_target },
                  ]}
                  reasons={reasons(d.dqs)}
                />
              </Card>
              <Card title={t("Rows in source and target")} sub={t("Top bar is the source. Bottom bar is the target.")}>
                {d.entities.length ? <CountsChart rows={d.entities} label={t("Rows in source and target")} /> : <EmptyState heading={t("Nothing to compare")} />}
              </Card>
              <Card title={t("By entity")} sub={t("Select an entity to see sample rows that differ.")}>
                <DataTable columns={cols()} rows={d.entities} rowKey={(r) => r.entity} label={t("By entity")} selected={pick} onSelect={(r) => setPick(r.entity)} />
              </Card>
              {sel ? (
                <Card title={t("Sample rows for {entity}", { entity: sel.entity })}>
                  {keys.length ? (
                    <div className="mx-table"><table>
                      <thead><tr>{keys.map((k) => <th key={k} scope="col">{k}</th>)}</tr></thead>
                      <tbody>{sel.sample.map((row, i) => <tr key={i}>{keys.map((k) => <td key={k}>{String(row[k] ?? "")}</td>)}</tr>)}</tbody>
                    </table></div>
                  ) : <EmptyState heading={t("No sample rows")} body={t("Nothing differs for this entity.")} />}
                </Card>
              ) : null}
              <div className="mx-actions">
                <Button onClick={onBack}>{t("Back")}</Button>
                <Button onClick={() => start.mutate()}>{t("Reconcile again")}</Button>
                <Button variant="primary" onClick={onNext}>{t("Plan the cut-over delta")}</Button>
              </div>
            </>
          ) : null}
        </Gate>
      )}
    </div>
  );
}
