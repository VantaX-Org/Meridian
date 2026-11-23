"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { useProcessDocument } from "@/lib/v2/mdm-queries";
import { DQ_WORD, stepsOf, type StepView } from "@/lib/v2/process-tree";
import { t } from "@/lib/v2/i18n";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Skeleton, StatTile, type Column } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { Lead } from "./Lead";
import { objectPath, useTabChat } from "./TabFrame";

/** The as-is process steps this object feeds, with the rules that fail in each. */
export function Processes({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const fx = useFixture();
  const q = useProcessDocument(o.runId, module, !o.runsLoading);
  const steps = useMemo(() => stepsOf(q.data?.processes ?? []), [q.data]);
  useTabChat(system, module, "processes", o.label, [t("Which process steps are blocked?")], () => ({
    text: t("{n} process steps are blocked.", { n: steps.filter((s) => s.blocked).length }),
    evidence: steps.filter((s) => s.blocked).slice(0, 3).map((s) => `${s.id}: ${s.name}`),
  }));
  if (o.runsLoading || q.isLoading) return <Skeleton lines={6} label={t("Loading processes")} />;
  if (q.isError) return <ErrorState heading={t("Processes could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const cols: Column<StepView>[] = [
    { key: "i", label: t("Step"), render: (s) => <FieldChip code={s.id} description={s.name} /> },
    { key: "p", label: t("Process"), render: (s) => `${s.l1Name}, ${s.l2Name}` },
    { key: "c", label: t("Transaction"), render: (s) => (s.tcode ? <FieldChip code={s.tcode} /> : "") },
    { key: "s", label: t("Status"), sort: (s) => s.status, render: (s) => DQ_WORD[s.status] },
    { key: "r", label: t("Failing rules"), align: "end", sort: (s) => s.rules.length, render: (s) => <span className="mx-num">{s.rules.length}</span> },
    { key: "a", label: t("Records affected"), align: "end", sort: (s) => s.recordsAtLeast, render: (s) => <span className="mx-num">{s.recordsAtLeast}</span> },
  ];
  return (
    <div className="mx-col">
      <Lead tab="processes" title={t("Process steps by status")} sentence={t("{n} of {m} process steps are blocked.", { n: steps.filter((s) => s.status === "red").length, m: steps.length })}
        bars={(["green", "amber", "red"] as const).map((k) => ({ id: k, label: DQ_WORD[k], value: steps.filter((s) => s.status === k).length, tone: ({ green: "good", amber: "warn", red: "bad" } as const)[k] }))} />
      <dl className="mx-tiles">
        <StatTile label={t("Steps")} value={String(steps.length)} />
        <StatTile label={t("Blocked")} value={String(steps.filter((s) => s.blocked).length)} />
      </dl>
      <Card title={t("Process steps")} action={<Link className="mx-btn" data-variant="secondary" href={withFixture(o.hrefWith(objectPath(system, module, "processes/design")), fx)}>{t("Open the process designer")}</Link>}>
        {steps.length ? <DataTable id="object-processes" columns={cols} rows={steps} rowKey={(s) => s.id} label={t("Process steps")} height={440} /> : <EmptyState heading={q.data?.reason ? t("No process definition exists for this object yet.") : t("No process step touches this object.")} body={t("Add a process definition or a step that uses this object.")} />}
      </Card>
    </div>
  );
}
