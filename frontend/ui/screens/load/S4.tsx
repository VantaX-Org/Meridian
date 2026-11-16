"use client";

import { useState } from "react";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import type { S4Area } from "@/lib/api/v2/s4";
import { Card, DataTable, EmptyState, FieldChip, MasterList, PageHeader, Sheet, StatTile, useAletheiaScope, useStacked, type Severity } from "@/ui/kit";
import { AskButton, Gate, humanize, pct } from "./common";
import { useS4 } from "./hooks";

const sevOf = (s: string): Severity => (s === "red" ? "critical" : s === "amber" ? "medium" : s === "green" ? "low" : "info");
const statusLabel = (s: string): string => (s === "red" ? t("Failing") : s === "amber" ? t("Warning") : s === "green" ? t("Passing") : t("Not evaluated"));

/** Rules that must pass before the move to S/4, grouped by the simplification area they come from. */
export function S4() {
  useInterfaceLang();
  const q = useS4();
  const stacked = useStacked();
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const d = q.data;
  const areas = d?.areas ?? [];
  const cur: S4Area | null = areas.find((a) => a.area === sel) ?? (stacked ? null : areas[0] ?? null);
  const max = Math.max(1, ...areas.map((a) => a.failing_records));

  useAletheiaScope({
    key: "load/s4",
    label: t("Asking about S/4 readiness"),
    suggestions: [t("Which area blocks the move?")],
    answer: () => {
      const bad = areas.filter((a) => a.blocking_failing > 0);
      return bad.length
        ? { text: t("{n} areas have blocking rules that fail.", { n: bad.length }), evidence: bad.slice(0, 5).map((a) => `${a.area} ${a.label}`) }
        : { text: t("No area has a blocking rule that fails."), evidence: [] };
    },
  });

  const detail = cur ? (
    <Card title={`${cur.area} ${cur.label}`} sub={cur.simplification_item ?? undefined}>
      <dl className="mx-tiles">
        <StatTile label={t("Rules")} value={String(cur.rules)} />
        <StatTile label={t("Evaluated")} value={String(cur.evaluated)} />
        <StatTile label={t("Failing records")} value={String(cur.failing_records)} />
        <StatTile label={t("Blocking")} value={String(cur.blocking_failing)} />
      </dl>
      {cur.checks.length ? (
        <DataTable
          label={t("Checks")}
          rows={cur.checks}
          rowKey={(c) => c.check_id}
          columns={[
            { key: "id", label: t("Rule"), sort: (c) => c.check_id, render: (c) => <FieldChip code={c.check_id} description={humanize(c.module ?? "")} /> },
            { key: "i", label: t("Impact"), render: (c) => (c.impact === "blocking" ? t("Blocking") : t("Warning")) },
            { key: "s", label: t("Status"), render: (c) => <span className="mx-sev" data-sev={sevOf(c.status)}><i className="mx-dot" aria-hidden="true" />{statusLabel(c.status)}</span> },
            { key: "a", label: t("Records affected"), align: "end", sort: (c) => c.affected_count, render: (c) => c.affected_count },
            { key: "p", label: t("Pass rate"), align: "end", sort: (c) => c.pass_rate ?? -1, render: (c) => pct(c.pass_rate) },
          ]}
        />
      ) : <EmptyState heading={t("No check in this area")} />}
    </Card>
  ) : <EmptyState heading={t("Choose an area")} body={t("Its checks appear here.")} />;

  return (
    <>
      <PageHeader title={t("S/4 readiness")} context={t("Rules that must pass before the move to S/4HANA.")} actions={<AskButton />} />
      <dl className="mx-tiles">
        <StatTile label={t("Rules")} value={String(d?.rules ?? 0)} />
        <StatTile label={t("Evaluated")} value={String(d?.evaluated ?? 0)} />
        <StatTile label={t("Failing records")} value={String(d?.failing_records ?? 0)} />
        <StatTile label={t("Blocking rules failing")} value={String(d?.blocking_failing ?? 0)} />
        <StatTile label={t("Assessment")} value={d?.ready ? t("Ready") : d?.assessment === "not_assessed" ? t("Not assessed") : t("Not ready")} />
      </dl>
      <div className="mx-split">
        <div className="mx-col">
          <Card title={t("Areas")}>
            <Gate loading={q.isLoading} error={q.isError} what={t("S/4 readiness")}>
              {areas.length ? (
                <MasterList
                  label={t("Areas")}
                  selectedId={cur?.area ?? null}
                  onSelect={(id) => { setSel(id); setOpen(true); }}
                  rows={areas.map((a) => ({ id: a.area, severity: sevOf(a.status), severityLabel: statusLabel(a.status), code: a.area, text: a.label, field: a.simplification_item ? { code: a.simplification_item, description: a.label } : undefined, countLabel: String(a.failing_records), ratio: a.failing_records / max }))}
                />
              ) : <EmptyState heading={t("No S/4 rule evaluated yet")} body={t("Run an analysis to evaluate the rules.")} />}
            </Gate>
          </Card>
        </div>
        {stacked ? <Sheet open={open && cur !== null} onClose={() => setOpen(false)} label={t("Area detail")} closeLabel={t("Close")}>{detail}</Sheet> : <div className="mx-col">{detail}</div>}
      </div>
    </>
  );
}
