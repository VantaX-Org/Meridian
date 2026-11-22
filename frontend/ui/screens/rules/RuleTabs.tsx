"use client";

import "./rules.css";
import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import { BarList, Button, Card, DataTable, EmptyState, FieldChip, Skeleton, StatTile, YamlView, type Column } from "@/ui/kit";
import type { RuleScope } from "@/lib/api/v2/object";
import { RECORDS_PAGE, useFailingRecords, type FailingRecord } from "@/lib/api/next/failing";
import { useRuleFailuresBy, useRuleHistory } from "@/lib/v2/object-queries";
import { compactCount, pct, sevLabel } from "./format";
import { useRuleReads } from "./queries";

const fieldCode = (f: string | null | undefined) => (f ? <FieldChip code={f} description={describeField(f) ?? ""} /> : <span className="mx-muted">{t("n/a")}</span>);

export function OverviewTab({ id, scope }: { id: string; scope: RuleScope }) {
  const d = scope.definition;
  const a = scope.authority;
  return (
    <div className="mx-rules-form">
      <dl className="mx-tiles">
        <StatTile label={t("Severity")} value={sevLabel(d.severity)} />
        <StatTile label={t("Records failing")} value={compactCount(scope.failing_records)} />
        <StatTile label={t("Objects")} value={scope.objects.length} />
        <StatTile label={t("Systems")} value={scope.systems.length} />
        <StatTile label={t("Field")} value={fieldCode(d.field)} />
      </dl>
      <p>{d.message}</p>
      {a.rule_authority ? <p className="mx-muted">{t("Authority: {a}", { a: a.rule_authority })}</p> : null}
      <YamlView label={t("Rule definition")} text={d.expression || JSON.stringify(d.params, null, 2)} />
      {scope.objects.length ? (
        <BarList label={t("Where the rule fails")} items={scope.objects.map((o) => ({ id: `${o.system_id}/${o.module}`, label: `${o.label}${o.system_name ? `, ${o.system_name}` : ""}`, value: o.failing, display: compactCount(o.failing) }))} />
      ) : <EmptyState heading={t("This rule fails nowhere")} />}
      {scope.contracts.length ? <p className="mx-muted">{t("Named in {n} data contracts", { n: scope.contracts.length })}</p> : null}
      <Button variant="ghost" href="/admin/scoring">{t("Scoring weights and thresholds")}</Button>
      <span hidden>{id}</span>
    </div>
  );
}

export function WhyTab({ id, scope }: { id: string; scope: RuleScope }) {
  const reads = useRuleReads(id);
  const by = useRuleFailuresBy(id);
  const a = scope.authority;
  return (
    <div className="mx-rules-form">
      {a.why_it_matters ? <p>{a.why_it_matters}</p> : null}
      {a.sap_impact ? <p className="mx-muted">{a.sap_impact}</p> : null}
      <h3 className="mx-card-t">{t("What the rule reads")}</h3>
      {reads.isLoading ? <Skeleton lines={3} label={t("Loading the lineage")} /> : reads.data ? (
        <>
          <div className="mx-rules-row">{reads.data.fields.map((f) => <FieldChip key={f} code={f} description={describeField(f) ?? ""} />)}</div>
          <p className="mx-muted">{t("Tables: {tables}", { tables: reads.data.tables.join(", ") || t("n/a") })}</p>
          {reads.data.glossary_terms.map((g) => <p key={g.id}>{g.business_name}</p>)}
          {reads.data.owners.map((o) => <p key={`${o.kind}${o.ref}`} className="mx-muted">{[o.ref, o.owner_name, o.steward_name].filter(Boolean).join(", ")}</p>)}
        </>
      ) : <p className="mx-muted">{t("Lineage is not available for this rule.")}</p>}
      <h3 className="mx-card-t">{t("Where the failures sit")}</h3>
      {by.data?.groups.length ? by.data.groups.map((g) => (
        <BarList key={g.field} label={g.field} items={g.values.slice(0, 6).map((v) => ({ id: v.value, label: `${g.field} ${v.value}`, value: v.records, display: compactCount(v.records) }))} />
      )) : <EmptyState heading={t("No split of the failures is available.")} />}
    </div>
  );
}

export function HistoryTab({ id }: { id: string }) {
  const q = useRuleHistory(id);
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading the history")} />;
  const runs = q.data ?? [];
  if (!runs.length) return <EmptyState heading={t("This rule has not run yet")} />;
  return (
    <Card title={t("Runs")}>
      <DataTable
        label={t("Rule runs")}
        rowKey={(r) => r.version_id}
        rows={runs}
        height={320}
        columns={[
          { key: "run_at", label: t("Run"), render: (r) => r.run_at.slice(0, 16).replace("T", " ") },
          { key: "affected_count", label: t("Records failing"), align: "end", render: (r) => compactCount(r.affected_count) },
          { key: "total_count", label: t("Checked"), align: "end", render: (r) => compactCount(r.total_count) },
          { key: "pass_rate", label: t("Pass rate"), align: "end", render: (r) => pct(r.pass_rate) },
          { key: "suppressed", label: t("Suppressed"), render: (r) => (r.suppressed ? t("Yes") : t("No")) },
        ]}
      />
    </Card>
  );
}
