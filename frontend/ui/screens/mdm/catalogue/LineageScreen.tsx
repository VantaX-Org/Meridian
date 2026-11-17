"use client";

import { useState } from "react";
import { getFieldLineage } from "@/lib/api/v2/field-lineage";
import { getGuards, getLineageModel, getRuleLineage, type GuardStep } from "@/lib/api/v2/lineage";
import { t } from "@/lib/v2/i18n";
import { Card, Code, DataTable, Field, Input, Select, StatTile, Tabs } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope } from "./shared";
import { LineageGraph } from "./LineageGraph";

const MODULES = ["material_master", "customer_master", "vendor_master"];

export function LineageScreen() {
  const [tab, setTab] = useState("graph");
  const [rule, setRule] = useState("MM142");
  const [node, setNode] = useState("");
  const [mod, setMod] = useState(MODULES[0]);
  const model = useRead(["lineage", "model"], getLineageModel);
  const graph = useRead(["lineage", "graph", rule], () => getRuleLineage(rule), tab === "graph" && !!rule);
  const kpi = node || model.data?.kpis[0]?.id || "";
  const guards = useRead(["lineage", "guards", kpi], () => getGuards(kpi), tab === "guards" && !!kpi);
  const fields = useRead(["lineage", "fields", mod], () => getFieldLineage(mod), tab === "fields");
  useScreenScope("lineage", t("Lineage"), [
    { prompt: t("Which steps have no guarding rule?"), answer: () => ({ text: (guards.data?.coverage_gaps ?? []).join(", ") || t("None") }) },
  ]);
  return (
    <>
      <Head title={t("Lineage")} context={model.data ? `${num(model.data.edge_count)} ${t("edges")}` : undefined} />
      <Async q={model} lines={2}>
        {(m) => (
          <dl className="mx-tiles">
            {Object.entries(m.node_counts).map(([k, v]) => <StatTile key={k} label={k} value={num(v)} />)}
          </dl>
        )}
      </Async>
      <Tabs idBase="lineage" label={t("Lineage views")} value={tab} onChange={setTab}
        items={[{ id: "graph", label: t("Rule graph") }, { id: "guards", label: t("Guards") }, { id: "fields", label: t("Fields") }]} />
      {tab === "graph" ? (
        <Card title={t("What a rule touches")} sub={t("Upstream on the left, downstream on the right")}>
          <Field label={t("Rule")}><Input value={rule} onChange={(e) => setRule(e.target.value.trim())} /></Field>
          <Async q={graph}>{(g) => g.nodes.length ? <LineageGraph graph={g} /> : <Empty heading={t("No lineage for this rule")} />}</Async>
        </Card>
      ) : null}
      {tab === "guards" ? (
        <>
          <Field label={t("KPI")}>
            <Select value={kpi} onChange={(e) => setNode(e.target.value)} options={(model.data?.kpis ?? []).map((k) => ({ value: k.id, label: k.label }))} />
          </Field>
          <Async q={guards}>
            {(g) => g.steps.length ? (
              <DataTable<GuardStep> label={t("Guards")} rows={g.steps} rowKey={(s) => s.id} height={420}
                columns={[
                  { key: "s", label: t("Step"), sort: (s) => s.label, render: (s) => <Code code={s.tcode ?? s.id} description={s.label} /> },
                  { key: "g", label: t("Rules"), align: "end", sort: (s) => s.guard_count, render: (s) => num(s.guard_count) },
                  { key: "p", label: t("Lowest pass rate"), align: "end", render: (s) => (s.min_pass_rate === null ? t("n/a") : `${s.min_pass_rate}%`) },
                  { key: "u", label: t("Unguarded fields"), render: (s) => s.unguarded_fields.map((f) => <Code key={f} code={f} />) },
                ]} />
            ) : <Empty heading={t("No steps behind this KPI")} />}
          </Async>
        </>
      ) : null}
      {tab === "fields" ? (
        <>
          <Field label={t("Object")}><Select value={mod} onChange={(e) => setMod(e.target.value)} options={MODULES.map((m) => ({ value: m, label: m }))} /></Field>
          <Async q={fields}>
            {(f) => {
              const rows = f.tables.flatMap((tb) => tb.fields.map((x) => ({ ...x, table: tb.table })));
              return rows.length ? (
                <DataTable label={t("Fields")} rows={rows} rowKey={(x) => `${x.table}.${x.field}`} height={420}
                  columns={[
                    { key: "t", label: t("Table"), sort: (x) => x.table, render: (x) => <Code code={x.table} /> },
                    { key: "f", label: t("Field"), sort: (x) => x.field, render: (x) => <Code code={x.field} description={x.text} /> },
                    { key: "c", label: t("Check table"), render: (x) => (x.check_table ? <Code code={x.check_table} description={x.check_table_text ?? undefined} /> : "") },
                    { key: "r", label: t("Rules"), align: "end", sort: (x) => x.rule_count, render: (x) => num(x.rule_count) },
                  ]} />
              ) : <Empty heading={t("No fields")} />;
            }}
          </Async>
        </>
      ) : null}
    </>
  );
}
