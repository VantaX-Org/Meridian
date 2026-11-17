"use client";

import { useState } from "react";
import { useAcrossSystems, useGoldenRecords } from "@/lib/v2/mdm-queries";
import { t } from "@/lib/v2/i18n";
import type { MasterRecordSummary } from "@/types/api";
import { Button, Card, DataTable, EmptyState, ErrorState, FieldChip, Skeleton, StatTile, type Column } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useTabChat } from "./TabFrame";

const GOLDEN_PER_PAGE = 25;

/** The object's golden records, and the duplicate clusters that span systems. */
export function Golden({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const [page, setPage] = useState(1);
  const g = useGoldenRecords(module, page);
  const x = useAcrossSystems(module);
  useTabChat(system, module, "golden", o.label, [t("How many golden records are pending review?")], () => ({
    text: t("{n} golden records exist for this object.", { n: g.data?.total ?? 0 }),
    evidence: (g.data?.records ?? []).slice(0, 3).map((r) => `${r.sap_object_key}: ${r.status}`),
  }));
  if (g.isLoading) return <Skeleton lines={6} label={t("Loading golden records")} />;
  if (g.isError || !g.data) return <ErrorState heading={t("Golden records could not be loaded.")} />;
  const cols: Column<MasterRecordSummary>[] = [
    { key: "k", label: t("Record"), render: (r) => <FieldChip code={r.sap_object_key} /> },
    { key: "s", label: t("Status"), render: (r) => r.status },
    { key: "c", label: t("Confidence"), align: "end", sort: (r) => r.overall_confidence, render: (r) => <span className="mx-num">{Math.round(r.overall_confidence * (r.overall_confidence <= 1 ? 100 : 1))}%</span> },
    { key: "n", label: t("Sources"), align: "end", render: (r) => <span className="mx-num">{r.source_count}</span> },
    { key: "p", label: t("Pending issues"), align: "end", sort: (r) => r.pending_issues, render: (r) => <span className="mx-num">{r.pending_issues}</span> },
  ];
  const last = Math.max(1, Math.ceil(g.data.total / GOLDEN_PER_PAGE));
  const cl = x.data;
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Golden records")} value={String(g.data.total)} />
        <StatTile label={t("Duplicate pairs across systems")} value={String(cl?.pairs ?? 0)} />
      </dl>
      <Card title={t("Golden records")} action={<span className="mx-links"><Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("Previous page")}</Button><span className="mx-muted">{t("Page {p} of {n}", { p: page, n: last })}</span><Button variant="ghost" disabled={page >= last} onClick={() => setPage(page + 1)}>{t("Next page")}</Button></span>}>
        {g.data.records.length ? <DataTable columns={cols} rows={g.data.records} rowKey={(r) => r.id} label={t("Golden records")} /> : <EmptyState heading={t("No golden records exist for this object yet.")} />}
      </Card>
      <Card title={t("Duplicates across systems")}>
        {cl?.clusters.length ? (
          <ul className="mx-col">
            {cl.clusters.slice(0, 8).map((c) => (
              <li key={c.id}>{c.members.map((m) => <span key={`${m.system_id}:${m.key}`}><FieldChip code={m.key} description={m.text ?? undefined} />{" "}<span className="mx-muted">{m.system_name ?? ""}</span>{" "}</span>)}</li>
            ))}
          </ul>
        ) : <EmptyState heading={t("No duplicates span two systems.")} />}
      </Card>
    </div>
  );
}
