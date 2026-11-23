"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiDetail, startReconcile, useReconciliation, type ReconEntity, type Reconciliation } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, DataTable, DqsPair, EmptyState, FieldChip, type Column } from "@/ui/kit";
import { Gate } from "../common";
import { CountsChart } from "./charts";

const num = (n: number) => n.toLocaleString("en");

const diffs = (r: ReconEntity) => Object.values(r.field_diffs ?? {}).reduce((a, n) => a + n, 0);

const cols = (): Column<ReconEntity>[] => [
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} />, sort: (r) => r.entity },
  { key: "source_rows", label: t("Source rows"), align: "end", render: (r) => <span className="mx-num">{num(r.source_rows)}</span>, sort: (r) => r.source_rows },
  { key: "target_rows", label: t("Target rows"), align: "end", render: (r) => <span className="mx-num">{num(r.target_rows)}</span>, sort: (r) => r.target_rows },
  { key: "missing_in_target", label: t("Missing in target"), align: "end", render: (r) => <span className="mx-num">{num(r.missing_in_target.length)}</span>, sort: (r) => r.missing_in_target.length },
  { key: "extra_in_target", label: t("Extra in target"), align: "end", render: (r) => <span className="mx-num">{num(r.extra_in_target.length)}</span>, sort: (r) => r.extra_in_target.length },
  { key: "field_diffs", label: t("Field differences"), align: "end", render: (r) => <span className="mx-num">{num(diffs(r))}</span>, sort: diffs },
];

type Sample = ReconEntity["sample"][number] & { k: string };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? t("empty") : String(v));
const sampleCols = (): Column<Sample>[] => [
  { key: "key", label: t("Record"), render: (r) => <span className="mx-num">{r.key}</span>, sort: (r) => r.key },
  { key: "field", label: t("Field"), render: (r) => <FieldChip code={r.field} />, sort: (r) => r.field },
  { key: "source", label: t("Source"), render: (r) => show(r.source) },
  { key: "target", label: t("Target"), render: (r) => show(r.target) },
];

export const reasons = (d: NonNullable<Reconciliation["dqs"]>) => d.reasons.map((x) => ({ label: x, value: "" }));

/** Step 6: counts source against target, the rows that differ, and the three quality scores with why they differ. */
export function Reconcile({ planId, onBack, onNext }: { planId: string; onBack: () => void; onNext: () => void }) {
  const [id, setId] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const start = useMutation({ mutationFn: () => startReconcile(planId), onSuccess: (x) => setId(x.id) });
  const q = useReconciliation(id);
  const d = q.data;
  const sel = d?.entities.find((e) => e.entity === pick);
  const sample: Sample[] = (sel?.sample ?? []).map((x, i) => ({ ...x, k: `${i}` }));

  return (
    <div className="mx-col">
      {!id ? (
        <Card title={t("Compare the two systems")} sub={t("Counts every entity in the source and in the target and lists what differs.")}>
          <div className="mx-actions">
            <Button onClick={onBack}>{t("Back")}</Button>
            <Button variant="primary" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? t("Comparing") : t("Reconcile now")}</Button>
          </div>
          {start.isError ? <p className="mx-field-e" role="alert">{apiDetail(start.error) ?? t("The comparison could not start.")}</p> : null}
        </Card>
      ) : (
        <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the comparison")}>
          {d ? (
            <>
              {d.status === "failed" ? <p className="mx-field-e" role="alert">{d.reason ?? t("The comparison failed.")}</p> : null}
              {d.status !== "completed" && d.status !== "failed" ? <p className="mx-muted" role="status">{t("Comparing the two systems. This page updates by itself.")}</p> : null}
              {d.dqs ? <Card title={t("Data quality score")} sub={t("The score before the move, what it should be after, and what it is.")}>
                <DqsPair
                  naLabel={t("n/a")}
                  rows={[
                    { key: "source", label: t("Source"), value: d.dqs.source },
                    { key: "projected", label: t("Projected target"), value: d.dqs.projected_target },
                    { key: "actual", label: t("Actual target"), value: d.dqs.actual_target },
                  ]}
                  reasons={reasons(d.dqs)}
                />
              </Card> : null}
              <Card title={t("Rows in source and target")} sub={t("Top bar is the source. Bottom bar is the target.")}>
                {d.entities.length ? <CountsChart rows={d.entities} label={t("Rows in source and target")} /> : <EmptyState heading={t("Nothing to compare")} body={t("Run the reconciliation after the load to compare the two sides.")} />}
              </Card>
              <Card title={t("By entity")} sub={t("Select an entity to see sample rows that differ.")}>
                <DataTable columns={cols()} rows={d.entities} rowKey={(r) => r.entity} label={t("By entity")} selected={pick} onSelect={(r) => setPick(r.entity)} />
              </Card>
              {sel ? (
                <Card title={t("Sample rows for {entity}", { entity: sel.entity })}>
                  {sample.length ? <DataTable columns={sampleCols()} rows={sample} rowKey={(r) => r.k} label={t("Sample rows for {entity}", { entity: sel.entity })} /> : <EmptyState heading={t("No sample rows")} body={t("Nothing differs for this entity.")} />}
                </Card>
              ) : null}
              {start.isError ? <p className="mx-field-e" role="alert">{apiDetail(start.error) ?? t("The comparison could not start.")}</p> : null}
              <div className="mx-actions">
                <Button onClick={onBack}>{t("Back")}</Button>
                <Button disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? t("Comparing") : t("Reconcile again")}</Button>
                <Button variant="primary" onClick={onNext}>{t("Plan the cut-over delta")}</Button>
              </div>
            </>
          ) : null}
        </Gate>
      )}
    </div>
  );
}
