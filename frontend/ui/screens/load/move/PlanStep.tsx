"use client";

import { useState } from "react";
import { usePlan, type Cleansing, type MoveMethod, type MovePlan, type ReviewItem, type RuleFixes } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, DataTable, DqsPair, EmptyState, FieldChip, Sheet, StatTile, type Column } from "@/ui/kit";
import { Gate, humanize } from "../common";

const methods = (): Record<MoveMethod, string> => ({
  odata_upsert: t("OData upsert"),
  bapi: t("BAPI"),
  file_load: t("File load"),
  archive_only: t("Archive only"),
});

interface Row { key: string; wave: number; label: string; module: string; entity: string; method: MoveMethod; rows: number; history_rows: number; depends_on: string[] }

export const flatten = (p: MovePlan): Row[] =>
  p.waves.flatMap((w) => w.steps.map((s) => ({ key: `${w.wave}:${s.entity}`, wave: w.wave, label: w.label, module: s.module, entity: s.entity, method: s.method, rows: s.rows, history_rows: s.history_rows, depends_on: s.depends_on })));

const num = (n: number) => n.toLocaleString("en");

const cols = (): Column<Row>[] => [
  { key: "wave", label: t("Wave"), render: (r) => `${r.wave} ${r.label}`, sort: (r) => r.wave },
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} description={humanize(r.module)} />, sort: (r) => r.entity },
  { key: "method", label: t("Method"), render: (r) => methods()[r.method] ?? r.method },
  { key: "rows", label: t("Rows"), align: "end", render: (r) => <span className="mx-num">{num(r.rows)}</span>, sort: (r) => r.rows },
  { key: "history_rows", label: t("History rows"), align: "end", render: (r) => <span className="mx-num">{num(r.history_rows)}</span>, sort: (r) => r.history_rows },
  { key: "depends_on", label: t("Waits for"), render: (r) => (r.depends_on.length ? r.depends_on.join(", ") : "") },
];

const unplacedText = (u: MovePlan["unplaced"][number]) => (typeof u === "string" ? u : [u.module && humanize(u.module), u.entity, u.reason].filter(Boolean).join(": "));

const fixCols = (): Column<RuleFixes>[] => [
  { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.rule_id} description={r.description} />, sort: (r) => r.rule_id },
  { key: "cells", label: t("Cells fixed"), align: "end", render: (r) => <span className="mx-num">{num(r.cells)}</span>, sort: (r) => r.cells },
];

const reviewCols = (): Column<ReviewItem>[] => [
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} />, sort: (r) => r.entity },
  { key: "key", label: t("Record"), render: (r) => r.key },
  { key: "field", label: t("Field"), render: (r) => <FieldChip code={r.field} />, sort: (r) => r.field },
  { key: "value", label: t("Value that will load"), render: (r) => r.value },
  { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.rule_id} description={r.description} /> },
];

function CleansingCard({ c }: { c: Cleansing }) {
  const [open, setOpen] = useState(false);
  const top = [...c.cells_fixed_by_rule].sort((a, b) => b.cells - a.cells).slice(0, 5);
  const total = c.cells_fixed_by_rule.reduce((a, r) => a + r.cells, 0);
  return (
    <Card title={t("Cleaned automatically")} sub={t("Every rule fix is applied before the load. Nothing needs your approval.")}>
      <div className="mx-col">
        <dl className="mx-tiles">
          <StatTile label={t("Cells fixed")} value={num(total)} />
          <StatTile label={t("Still needs review")} value={num(c.records_still_failing)} />
        </dl>
        <DqsPair naLabel={t("n/a")} rows={[{ key: "source", label: t("Before cleaning"), value: c.dqs_before }, { key: "actual", label: t("After cleaning"), value: c.dqs_after }]} />
        {top.length ? <DataTable columns={fixCols()} rows={top} rowKey={(r) => r.rule_id} label={t("Top rules by fixes")} /> : null}
        <p className="mx-muted">{t("Records that still need review load with their current value. Nothing is held back.")}</p>
        <div className="mx-actions">
          <Button disabled={!c.needs_review.length} onClick={() => setOpen(true)}>{t("Show the {n} records to review", { n: c.records_still_failing })}</Button>
        </div>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} label={t("Still needs review")} closeLabel={t("Close")}>
        <p className="mx-muted">{t("These records load with the value shown. Fix them in the source or after the load.")}</p>
        <DataTable columns={reviewCols()} rows={c.needs_review} rowKey={(r) => `${r.entity}:${r.key}:${r.field}:${r.rule_id}`} label={t("Still needs review")} />
      </Sheet>
    </Card>
  );
}

/** Step 3: the load order in waves. Anything the plan could not place is listed first, so nothing is silently left behind. */
export function PlanStep({ planId, onBack, onNext }: { planId: string; onBack: () => void; onNext: () => void }) {
  const q = usePlan(planId);
  const p = q.data;
  const rows = p ? flatten(p) : [];
  const unplaced = p?.unplaced ?? [];
  return (
    <Gate loading={q.isLoading} error={q.isError} what={t("the plan")}>
      <div className="mx-col">
        {unplaced.length ? (
          <Card title={t("{n} not placed in any wave", { n: unplaced.length })} sub={t("These will not move until you fix the reason shown.")}>
            <ul data-testid="unplaced">{unplaced.map((u, i) => <li key={i}>{unplacedText(u)}</li>)}</ul>
          </Card>
        ) : null}
        <dl className="mx-tiles">
          <StatTile label={t("History rows")} value={num(rows.reduce((a, r) => a + r.history_rows, 0))} />
          <StatTile label={t("Rows")} value={num(rows.reduce((a, r) => a + r.rows, 0))} />
          <StatTile label={t("Waves")} value={p?.waves.length ?? 0} />
          <StatTile label={t("Entities")} value={rows.length} />
        </dl>
        {p?.mode === "cleansed" && p.cleansing ? <CleansingCard c={p.cleansing} /> : null}
        <Card title={t("Load order")} sub={t("Each wave loads only after the waves it waits for are done.")}>
          {rows.length ? <DataTable columns={cols()} rows={rows} rowKey={(r) => r.key} label={t("Load order")} /> : <EmptyState heading={t("Nothing to move")} body={t("The plan holds no steps. Go back and choose objects.")} />}
        </Card>
        <div className="mx-actions">
          <Button onClick={onBack}>{t("Back")}</Button>
          <Button variant="primary" disabled={!rows.length} onClick={onNext}>{t("Check before loading")}</Button>
        </div>
      </div>
    </Gate>
  );
}
