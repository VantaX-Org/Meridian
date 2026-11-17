"use client";

import { useModels, useReferenceModel } from "@/lib/v2/sys-queries";
import { t } from "@/lib/v2/i18n";
import type { ModelSummary } from "@/types/process-model";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Skeleton, StatTile, type Column } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useTabChat } from "./TabFrame";

/** Process models and the SAP reference model that cover this object. */
// ponytail: read-only list; editing a model stays in the process designer owned by the systems batch.
export function ProcessDesign({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const models = useModels();
  const ref = useReferenceModel(true);
  const l1 = (ref.data?.l1 ?? []).filter((x) => x.modules.includes(module));
  useTabChat(system, module, "design", o.label, [t("Which reference processes cover this object?")], () => ({
    text: t("{n} reference processes cover this object.", { n: l1.length }),
    evidence: l1.slice(0, 3).map((x) => `${x.id}: ${x.name}`),
  }));
  if (models.isLoading || ref.isLoading) return <Skeleton lines={5} label={t("Loading process models")} />;
  if (models.isError && ref.isError) return <ErrorState heading={t("Process models could not be loaded.")} />;
  const cols: Column<ModelSummary>[] = [
    { key: "n", label: t("Model"), render: (m) => <FieldChip code={m.id} description={m.name} /> },
    { key: "s", label: t("Status"), render: (m) => m.status },
    { key: "v", label: t("Version"), align: "end", render: (m) => <span className="mx-num">{m.current_version}</span> },
    { key: "u", label: t("Updated"), render: (m) => (m.updated_at ?? "").slice(0, 10) },
  ];
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Models")} value={String(models.data?.length ?? 0)} />
        <StatTile label={t("Reference processes for this object")} value={String(l1.length)} />
      </dl>
      <Card title={t("Reference processes")}>
        {l1.length ? <ul className="mx-col">{l1.map((x) => <li key={x.id}><FieldChip code={x.id} description={x.name} />{" "}<span className="mx-muted">{x.description}</span></li>)}</ul> : <EmptyState heading={t("No reference process lists this object.")} />}
      </Card>
      <Card title={t("Your process models")}>
        {models.data?.length ? <DataTable columns={cols} rows={models.data} rowKey={(m) => m.id} label={t("Your process models")} /> : <EmptyState heading={t("No process model exists yet.")} />}
      </Card>
    </div>
  );
}
