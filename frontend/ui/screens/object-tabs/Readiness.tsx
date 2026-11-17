"use client";

import { useReadiness } from "@/lib/v2/object-queries";
import { t } from "@/lib/v2/i18n";
import type { ReadinessCell } from "@/lib/api/v2/object";
import { Card, DataTable, EmptyState, ErrorState, Skeleton, StatTile, type Column } from "@/ui/kit";
import { score } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useTabChat } from "./TabFrame";

const VERDICT = { go: () => t("Ready"), at_risk: () => t("At risk"), no_go: () => t("Blocked") } as const;

/** Go or no go for this object in each migration wave. */
export function Readiness({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const q = useReadiness();
  const rows = (q.data?.cells ?? []).filter((c) => c.module === module);
  useTabChat(system, module, "readiness", o.label, [t("What blocks the next wave?")], () => ({
    text: rows.length ? t("{n} waves are not ready.", { n: rows.filter((r) => r.verdict !== "go").length }) : t("This object is in no wave yet."),
    evidence: rows.slice(0, 3).map((r) => `${r.wave}: ${VERDICT[r.verdict]()}`),
  }));
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading readiness")} />;
  if (q.isError) return <ErrorState heading={t("Readiness could not be loaded.")} />;
  const cols: Column<ReadinessCell>[] = [
    { key: "w", label: t("Wave"), render: (r) => r.wave },
    { key: "v", label: t("Verdict"), render: (r) => VERDICT[r.verdict]() },
    { key: "s", label: t("Score"), align: "end", sort: (r) => r.score ?? 0, render: (r) => <span className="mx-num">{r.score === null ? "-" : score(r.score)}</span> },
    { key: "th", label: t("Threshold"), align: "end", render: (r) => <span className="mx-num">{r.threshold == null ? "-" : score(r.threshold)}</span> },
    { key: "b", label: t("Blockers"), align: "end", sort: (r) => r.blocker_count, render: (r) => <span className="mx-num">{r.blocker_count}</span> },
    { key: "r", label: t("Records blocked"), align: "end", sort: (r) => r.records_blocked, render: (r) => <span className="mx-num">{r.records_blocked}</span> },
  ];
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Waves")} value={String(rows.length)} />
        <StatTile label={t("Ready")} value={String(rows.filter((r) => r.verdict === "go").length)} />
        <StatTile label={t("Blockers")} value={String(rows.reduce((n, r) => n + r.blocker_count, 0))} />
      </dl>
      <Card title={t("Readiness by wave")}>
        {rows.length ? <DataTable columns={cols} rows={rows} rowKey={(r) => r.wave} label={t("Readiness by wave")} /> : <EmptyState heading={t("This object is not planned into a wave yet.")} />}
      </Card>
    </div>
  );
}
