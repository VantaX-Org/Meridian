"use client";

import { useBatches } from "@/lib/v2/approvals-queries";
import { BATCH_STATUS_LABEL, type BatchStatus } from "@/lib/v2/batches";
import { useWorkGroups } from "@/lib/v2/object-queries";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import type { WorkGroupRow } from "@/lib/api/v2/object";
import { Button, Card, DataTable, EmptyState, ErrorState, FieldChip, Skeleton, StatTile, type Column } from "@/ui/kit";
import { compactCount } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { sevLabel } from "./Records";
import { Lead, type Tone } from "./Lead";
import { useTabChat } from "./TabFrame";

const BATCH_STATES: [BatchStatus, Tone | undefined][] = [["draft", "warn"], ["approved", undefined], ["awaiting_load", undefined], ["exported", "good"]];

/** The fixes the object needs, grouped by rule, with how many already carry a proposed value. */
export function Fixes({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const fx = useFixture();
  const q = useWorkGroups(module, o.runId, !o.runsLoading);
  const rows = q.data ?? [];
  const batches = useBatches().rows.filter((b) => b.modules.includes(module));
  const open = rows.reduce((n, r) => n + r.open, 0);
  const proposed = rows.reduce((n, r) => n + r.proposed, 0);
  useTabChat(system, module, "fixes", o.label, [t("Where should we start fixing?")], () => {
    const top = [...rows].sort((a, b) => b.open - a.open)[0];
    return { text: top ? t("Start with {rule}: {n} records are open.", { rule: top.check_id, n: top.open }) : t("Nothing is open."), evidence: rows.slice(0, 3).map((r) => `${r.check_id}: ${r.open}`) };
  });
  if (q.isLoading || o.runsLoading) return <Skeleton lines={5} label={t("Loading fixes")} />;
  if (q.isError) return <ErrorState heading={t("The fixes could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const cols: Column<WorkGroupRow>[] = [
    { key: "c", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.message ?? undefined} /> },
    { key: "s", label: t("Severity"), render: (r) => <span className="mx-sev" data-sev={r.severity}>{sevLabel(r.severity)}</span> },
    { key: "r", label: t("Records"), align: "end", sort: (r) => r.records, render: (r) => <span className="mx-num">{r.records}</span> },
    { key: "p", label: t("With a proposed value"), align: "end", sort: (r) => r.proposed, render: (r) => <span className="mx-num">{r.proposed}</span> },
    { key: "o", label: t("Open"), align: "end", sort: (r) => r.open, render: (r) => <span className="mx-num">{r.open}</span> },
  ];
  return (
    <div className="mx-col">
      <Lead tab="fixes" title={t("Fix batches by state")} sentence={t("{n} fix batches hold records of this object.", { n: batches.length })}
        bars={BATCH_STATES.map(([s, tone]) => ({ id: s, label: BATCH_STATUS_LABEL[s], value: batches.filter((b) => b.status === s).length, tone }))} />
      <dl className="mx-tiles">
        <StatTile label={t("Open findings")} value={compactCount(open)} />
        <StatTile label={t("With a proposed value")} value={compactCount(proposed)} bar={open ? (100 * proposed) / open : 0} barTone="pass" />
      </dl>
      <Card title={t("Fixes by rule")} action={<Button variant="secondary" href={withFixture(`/work?module=${encodeURIComponent(module)}`, fx)}>{t("Open in the work queue")}</Button>}>
        {rows.length ? <DataTable id="object-fixes" columns={cols} rows={rows} rowKey={(r) => r.check_id} label={t("Fixes by rule")} /> : <EmptyState heading={t("No fixes are waiting for this object.")} body={t("Every finding of this run is fixed or not an issue. Open the work queue to check other objects.")} action={<Button href={withFixture("/work", fx)}>{t("Open the work queue")}</Button>} />}
      </Card>
    </div>
  );
}
