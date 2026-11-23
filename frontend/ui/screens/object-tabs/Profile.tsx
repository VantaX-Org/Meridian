"use client";

import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { describeField, describeTable } from "@/lib/v2/sap-fields";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Select, Skeleton, type Column } from "@/ui/kit";
import { compactCount, score } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useProfile } from "./hooks";
import { Lead } from "./Lead";
import { useTabChat } from "./TabFrame";

type Row = { field: string; rows: number; blank_pct: number; distinct: number; type: string | null; desc: string | null; top: string };

/** Per table and field: how full, how varied, what the values look like. */
export function Profile({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const p = useProfile(o.runId, module);
  const [table, setTable] = useState("");
  const tables = p.data?.tables ?? [];
  const cur = tables.find((x) => x.table === table) ?? tables[0];
  useTabChat(system, module, "profile", o.label, [t("Which fields are mostly empty?")], () => {
    const empty = tables.flatMap((x) => x.fields.map((f) => ({ k: `${x.table}.${f.field}`, b: f.stats.blank_pct }))).sort((a, b) => b.b - a.b).slice(0, 3);
    return { text: empty.length ? t("The emptiest field is {f}.", { f: empty[0].k }) : t("No profile yet."), evidence: empty.map((e) => `${e.k}: ${score(e.b)}%`) };
  });
  if (o.runsLoading || p.isLoading) return <Skeleton lines={6} label={t("Loading the profile")} />;
  if (p.isError) return <ErrorState heading={t("The profile could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void p.refetch()} />;
  if (!cur) return <EmptyState heading={t("No profile exists for this run.")} body={t("Pick a newer run, or pull the object again.")} />;
  const rows: Row[] = cur.fields.map((f) => ({
    field: f.field, rows: f.stats.rows, blank_pct: f.stats.blank_pct, distinct: f.stats.distinct, type: f.stats.ddic_type,
    desc: f.stats.description ?? describeField(`${cur.table}.${f.field}`),
    top: f.stats.masked ? t("Hidden") : (f.stats.top_values ?? []).slice(0, 3).map((v) => v.value).join(", "),
  }));
  const cols: Column<Row>[] = [
    { key: "f", label: t("Field"), render: (r) => <FieldChip code={r.field} description={r.desc ?? undefined} /> },
    { key: "t", label: t("Type"), render: (r) => r.type ?? "" },
    { key: "b", label: t("Empty"), align: "end", sort: (r) => r.blank_pct, render: (r) => <span className="mx-num">{score(r.blank_pct)}%</span> },
    { key: "d", label: t("Distinct values"), align: "end", sort: (r) => r.distinct, render: (r) => <span className="mx-num">{compactCount(r.distinct)}</span> },
    { key: "v", label: t("Most common values"), render: (r) => r.top },
  ];
  const full = rows.filter((r) => r.blank_pct <= 0).length;
  const empty = rows.filter((r) => r.blank_pct >= 100).length;
  return (
    <div className="mx-col">
    <Lead tab="profile" title={t("Fill rate of {table}", { table: cur.table })} sentence={t("{n} of {m} fields are filled on every row.", { n: full, m: rows.length })}
      bars={[{ id: "full", label: t("Filled on every row"), value: full, tone: "good" }, { id: "part", label: t("Partly blank"), value: rows.length - full - empty, tone: "warn" }, { id: "empty", label: t("Always blank"), value: empty, tone: "bad" }]} />
    <Card
      title={cur.table}
      sub={(describeTable(cur.table) ? `${describeTable(cur.table)}, ` : "") + (cur.sampled ? t("Sampled: {n} of {m} rows", { n: compactCount(cur.rows), m: compactCount(cur.table_rows) }) : t("{n} rows", { n: compactCount(cur.rows) }))}
      action={<Select aria-label={t("Table")} value={cur.table} onChange={(e) => setTable(e.target.value)} options={tables.map((x) => ({ value: x.table, label: x.table }))} />}
    >
      <DataTable id="object-fields" columns={cols} rows={rows} rowKey={(r) => r.field} label={t("Fields")} height={480} />
    </Card>
    </div>
  );
}
