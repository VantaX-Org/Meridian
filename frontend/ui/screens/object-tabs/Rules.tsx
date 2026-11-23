"use client";

import { useState } from "react";
import { useObjectRules } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import type { RuleRow } from "@/lib/api/v2/types";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Search, Skeleton, type Column } from "@/ui/kit";
import { score } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { sevLabel } from "./Records";
import { Lead } from "./Lead";
import { useTabChat } from "./TabFrame";

/** Every rule that ran on the object, with the field it checks in plain words. */
export function Rules({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const [q, setQ] = useState("");
  const rules = useObjectRules(module, o.runId);
  const all = rules.data ?? [];
  const rows = all.filter((r) => !q || `${r.check_id} ${r.name} ${r.field ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  useTabChat(system, module, "rules", o.label, [t("Which rule fails most?")], () => {
    const top = [...all].sort((a, b) => b.affected_count - a.affected_count)[0];
    return { text: top ? t("{rule} fails most: {n} records.", { rule: top.check_id, n: top.affected_count }) : t("No rule ran yet."), evidence: all.slice(0, 3).map((r) => `${r.check_id}: ${r.affected_count}`) };
  });
  if (rules.isLoading || o.runsLoading) return <Skeleton lines={6} label={t("Loading rules")} />;
  if (rules.isError) return <ErrorState heading={t("The rules could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void rules.refetch()} />;
  const cols: Column<RuleRow>[] = [
    { key: "c", label: t("Rule"), sort: (r) => r.check_id, render: (r) => <><FieldChip code={r.check_id} description={r.name} /></> },
    { key: "f", label: t("Field"), render: (r) => (r.field ? <FieldChip code={r.field} description={r.field_description ?? describeField(r.field) ?? undefined} /> : "") },
    { key: "s", label: t("Severity"), render: (r) => <span className="mx-sev" data-sev={r.severity}>{sevLabel(r.severity)}</span> },
    { key: "a", label: t("Failing"), align: "end", sort: (r) => r.affected_count, render: (r) => <span className="mx-num">{r.affected_count} / {r.total_count}</span> },
    { key: "p", label: t("Pass rate"), align: "end", sort: (r) => r.pass_rate ?? 0, render: (r) => <span className="mx-num">{r.pass_rate === null ? "-" : `${score(r.pass_rate * (r.pass_rate <= 1 ? 100 : 1))}%`}</span> },
  ];
  const failingRules = all.filter((r) => r.affected_count > 0).length;
  return (
    <div className="mx-col">
    <Lead tab="rules" title={t("Passing and failing rules")} sentence={t("{f} of {n} rules fail on at least one record.", { f: failingRules, n: all.length })}
      bars={[{ id: "pass", label: t("Passing"), value: all.length - failingRules, tone: "good" }, { id: "fail", label: t("Failing"), value: failingRules, tone: "bad" }]} />
    <Card title={t("Rules")} sub={t("{n} rules ran on this object", { n: all.length })} action={<Search value={q} onChange={setQ} label={t("Search rules")} clearLabel={t("Clear search")} placeholder={t("Search rules")} />}>
      {rows.length ? <DataTable columns={cols} rows={rows} rowKey={(r) => r.check_id} label={t("Rules")} height={480} /> : <EmptyState heading={t("No rule matches.")} body={t("Clear the search or choose another filter to see rules.")} />}
    </Card>
    </div>
  );
}
