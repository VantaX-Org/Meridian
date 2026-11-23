"use client";

import { useState } from "react";
import { useGlossary } from "@/lib/v2/mdm-queries";
import { t } from "@/lib/v2/i18n";
import type { GlossaryStatus, GlossaryTermSummary } from "@/types/api";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, Search, Skeleton, type Column } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { Lead } from "./Lead";
import { useTabChat } from "./TabFrame";

const STATUS: Record<GlossaryStatus, () => string> = { active: () => t("Active"), under_review: () => t("Under review"), deprecated: () => t("Deprecated") };

/** The business terms for the object's SAP fields. */
export function Glossary({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const [q, setQ] = useState("");
  const g = useGlossary(module, q);
  const rows = g.data?.terms ?? [];
  useTabChat(system, module, "glossary", o.label, [t("Which terms are mandatory for S/4HANA?")], () => ({
    text: t("{n} terms are mandatory for S/4HANA.", { n: rows.filter((r) => r.mandatory_for_s4hana).length }),
    evidence: rows.filter((r) => r.mandatory_for_s4hana).slice(0, 3).map((r) => `${r.sap_table}.${r.sap_field}`),
  }));
  if (g.isLoading) return <Skeleton lines={6} label={t("Loading the glossary")} />;
  if (g.isError) return <ErrorState heading={t("The glossary could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void g.refetch()} />;
  const cols: Column<GlossaryTermSummary>[] = [
    { key: "f", label: t("Field"), render: (r) => <FieldChip code={`${r.sap_table}.${r.sap_field}`} description={r.business_name} /> },
    { key: "b", label: t("Business name"), sort: (r) => r.business_name, render: (r) => r.business_name },
    { key: "m", label: t("S/4HANA"), render: (r) => (r.mandatory_for_s4hana ? t("Mandatory") : t("Optional")) },
    { key: "s", label: t("Status"), render: (r) => STATUS[r.status]?.() ?? r.status },
    { key: "r", label: t("Linked rules"), align: "end", sort: (r) => r.linked_rules_count, render: (r) => <span className="mx-num">{r.linked_rules_count}</span> },
  ];
  const st = (s: GlossaryStatus) => rows.filter((r) => r.status === s).length;
  return (
    <div className="mx-col">
    <Lead tab="glossary" title={t("Terms by status")} sentence={t("{n} of {m} terms are active.", { n: st("active"), m: rows.length })}
      bars={[{ id: "active", label: STATUS.active(), value: st("active"), tone: "good" }, { id: "under_review", label: STATUS.under_review(), value: st("under_review"), tone: "warn" }, { id: "deprecated", label: STATUS.deprecated(), value: st("deprecated"), tone: "bad" }]} />
    <Card title={t("Glossary")} sub={t("{n} terms", { n: g.data?.total ?? rows.length })} action={<Search value={q} onChange={setQ} label={t("Search the glossary")} clearLabel={t("Clear search")} placeholder={t("Search the glossary")} />}>
      {rows.length ? <DataTable id="object-glossary" columns={cols} rows={rows} rowKey={(r) => r.id} label={t("Glossary")} height={480} /> : <EmptyState heading={t("No glossary term matches.")} body={t("Clear the search to see every term.")} />}
    </Card>
    </div>
  );
}
