"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBlastRadius, type BlastTarget } from "@/lib/api/v2/lineage";
import { useFixture } from "@/lib/api/v2/fixture";
import type { RuleRow } from "@/lib/api/v2/types";
import { whole } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { BarList, Card, DataTable, EmptyState, ErrorState, FieldChip, Select, Skeleton, StatTile } from "@/ui/kit";

const STATUS: Record<BlastTarget["status"], () => string> = {
  ok: () => t("Counted"), not_joinable: () => t("Cannot be joined"), not_extracted: () => t("Not extracted"),
};

function Radius({ runId, checkId }: { runId: string; checkId: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "blast", fx, runId, checkId] as const, queryFn: () => getBlastRadius(runId, checkId), retry: false });
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading")} />;
  if (q.isError || !q.data) return <ErrorState heading={t("The blast radius could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  const b = q.data;
  const counted = b.targets.filter((x) => x.status === "ok");
  if (!b.failing_records || !b.targets.length) return <EmptyState heading={t("This rule has no failing records that reach documents.")} />;
  return (
    <div className="mx-col">
      <div className="mx-split">
        <StatTile label={t("Failing records")} value={whole(b.failing_records)} />
        <StatTile label={t("Documents reached")} value={whole(counted.reduce((n, x) => n + x.documents, 0))} />
        <StatTile label={t("Process steps touched")} value={whole(b.steps_touched.length)} />
      </div>
      {b.keys_truncated ? <p className="mx-muted">{t("Only the first failing records are traced.")}</p> : null}
      <BarList label={t("Documents by table")} items={counted.map((x) => ({ id: x.table, label: `${x.table} ${x.label}`, value: x.documents, display: whole(x.documents) }))} />
      <DataTable<BlastTarget> label={t("Tables reached")} rows={b.targets} rowKey={(x) => x.table} height={260}
        columns={[
          { key: "t", label: t("Table"), sort: (x) => x.table, render: (x) => <FieldChip code={x.table} description={x.label} /> },
          { key: "s", label: t("Status"), render: (x) => STATUS[x.status]() },
          { key: "d", label: t("Documents"), align: "end", sort: (x) => x.documents, render: (x) => (x.status === "ok" ? whole(x.documents) : t("n/a")) },
          { key: "r", label: t("Rows"), align: "end", sort: (x) => x.rows, render: (x) => (x.status === "ok" ? whole(x.rows) : t("n/a")) },
          { key: "o", label: t("Objects"), align: "end", render: (x) => (x.status === "ok" ? whole(x.objects_touched) : t("n/a")) },
          { key: "j", label: t("Joined on"), render: (x) => x.joined_on.join(", ") },
        ]} />
      {b.processes_touched.length ? <p className="mx-muted">{t("Processes touched")}{": "}{b.processes_touched.map((p) => p.replace(/^process:/, "")).join(", ")}</p> : null}
    </div>
  );
}

/** One rule's failing records followed into the transactional documents and processes they reach. */
export function BlastCard({ runId, rules }: { runId: string | null; rules: readonly Pick<RuleRow, "check_id" | "name">[] }) {
  const [pick, setPick] = useState("");
  if (!runId || !rules.length) return null;
  const id = rules.some((r) => r.check_id === pick) ? pick : rules[0].check_id;
  return (
    <Card title={t("Blast radius of a rule")} sub={t("The documents and processes the failing records of one rule reach.")}
      action={<Select aria-label={t("Rule")} value={id} onChange={(e) => setPick(e.target.value)} options={rules.map((r) => ({ value: r.check_id, label: `${r.check_id} ${r.name}` }))} />}>
      <Radius key={id} runId={runId} checkId={id} />
    </Card>
  );
}
