"use client";

import { usePlan, type CleansingSummary, type ConfigListCounts, type MoveMethod, type MovePlan } from "@/lib/api/next/move";
import { t } from "@/lib/v2/i18n";
import { Button, Card, DataTable, DqsPair, EmptyState, FieldChip, StatTile, type Column } from "@/ui/kit";
import { Gate, humanize } from "../common";

/** Each load method with a short description, so the code never stands alone. */
export const methods = (): Record<MoveMethod, { label: string; description: string }> => ({
  upsert: { label: t("Upsert"), description: t("Creates or updates each record through the target API.") },
  config_create: { label: t("Config create"), description: t("Creates missing configuration values first.") },
  bapi: { label: t("BAPI"), description: t("Posts each record through the standard SAP function.") },
  file_load: { label: t("File load"), description: t("Writes a load file in the target format.") },
  archive_only: { label: t("Archive only"), description: t("Kept as history in the archive, not loaded.") },
});

interface Row { key: string; wave: number; label: string; module: string; entity: string; method: MoveMethod; rows: number; history_rows: number; depends_on: string[] }

export const flatten = (p: MovePlan): Row[] =>
  p.waves.flatMap((w) => w.steps.map((s) => ({ key: `${w.wave}:${s.entity}`, wave: w.wave, label: w.label, module: s.module, entity: s.entity, method: s.method, rows: s.rows, history_rows: s.history_rows, depends_on: s.depends_on })));

const num = (n: number) => n.toLocaleString("en");

const cols = (mods: Map<string, string>): Column<Row>[] => [
  { key: "wave", label: t("Wave"), render: (r) => `${r.wave} ${r.label}`, sort: (r) => r.wave },
  { key: "entity", label: t("Entity"), render: (r) => <FieldChip code={r.entity} description={humanize(r.module)} />, sort: (r) => r.entity },
  { key: "method", label: t("Method"), render: (r) => { const m = methods()[r.method]; return m ? <FieldChip code={m.label} description={m.description} /> : <FieldChip code={r.method} />; } },
  { key: "rows", label: t("Rows"), align: "end", render: (r) => <span className="mx-num">{num(r.rows)}</span>, sort: (r) => r.rows },
  { key: "history_rows", label: t("History rows"), align: "end", render: (r) => <span className="mx-num">{num(r.history_rows)}</span>, sort: (r) => r.history_rows },
  { key: "depends_on", label: t("Waits for"), render: (r) => <>{r.depends_on.map((d) => <FieldChip key={d} code={d} description={mods.has(d) ? humanize(mods.get(d) as string) : undefined} />)}</> },
];

const unplacedText = (u: MovePlan["unplaced"][number]) => (typeof u === "string" ? u : [u.module && humanize(u.module), u.entity, u.reason].filter(Boolean).join(": "));

interface Fix { rule: string; cells: number }
const fixCols = (): Column<Fix>[] => [
  { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.rule} />, sort: (r) => r.rule },
  { key: "cells", label: t("Cells fixed"), align: "end", render: (r) => <span className="mx-num">{num(r.cells)}</span>, sort: (r) => r.cells },
];

interface ConfigRow extends ConfigListCounts { list: string }
const configCols = (): Column<ConfigRow>[] => [
  { key: "list", label: t("Configuration list"), render: (r) => <FieldChip code={r.list} description={humanize(r.list)} />, sort: (r) => r.list },
  { key: "present", label: t("Already in target"), align: "end", render: (r) => <span className="mx-num">{num(r.present)}</span>, sort: (r) => r.present },
  { key: "create", label: t("To create"), align: "end", render: (r) => <span className="mx-num">{num(r.create)}</span>, sort: (r) => r.create },
  { key: "conflict", label: t("Conflicts"), align: "end", render: (r) => <span className="mx-num">{num(r.conflict)}</span>, sort: (r) => r.conflict },
];

function CleansingCard({ c }: { c: CleansingSummary }) {
  const fixes = Object.entries(c.cells_fixed_per_rule ?? {}).map(([rule, cells]) => ({ rule, cells })).sort((a, b) => b.cells - a.cells);
  const total = fixes.reduce((a, r) => a + r.cells, 0);
  const o = c.dqs?.overall;
  return (
    <Card title={t("Cleaned automatically")} sub={t("Every rule fix is applied before the load. Nothing needs your approval.")}>
      <div className="mx-col">
        <dl className="mx-tiles">
          <StatTile label={t("Cells fixed")} value={num(total)} />
          <StatTile label={t("Still needs review")} value={num(c.records_still_failing)} />
        </dl>
        {o ? <DqsPair naLabel={t("n/a")} rows={[{ key: "source", label: t("Before cleaning"), value: o.before }, { key: "actual", label: t("After cleaning"), value: o.after }]} /> : null}
        {fixes.length ? <DataTable columns={fixCols()} rows={fixes.slice(0, 10)} rowKey={(r) => r.rule} label={t("Top rules by fixes")} /> : null}
        <p className="mx-muted">{t("Records that still need review load with their current value. Nothing is held back.")}</p>
      </div>
    </Card>
  );
}

function ConfigCard({ config }: { config: Record<string, ConfigListCounts> }) {
  const rows = Object.entries(config).map(([list, c]) => ({ list, ...c }));
  if (!rows.length) return null;
  return (
    <Card title={t("Configuration lists")} sub={t("Values the data needs in the target: already there, to create, or in conflict.")}>
      <DataTable columns={configCols()} rows={rows} rowKey={(r) => r.list} label={t("Configuration lists")} />
    </Card>
  );
}

/** Step 3: the load order in waves. Anything the plan could not place is listed first, so nothing is silently left behind. */
export function PlanStep({ planId, onBack, onNext }: { planId: string; onBack: () => void; onNext: () => void }) {
  const q = usePlan(planId);
  const p = q.data;
  const rows = p ? flatten(p) : [];
  const unplaced = p?.unplaced ?? [];
  const mods = new Map(rows.map((r) => [r.entity, r.module]));
  if (p?.status === "building") return <Card title={t("Making the plan")} sub={t("Downloading the full history of the source, then ordering the load. This page updates by itself.")}><p className="mx-muted" role="status">{t("Building")}</p></Card>;
  if (p?.status === "failed") return (
    <Card title={t("The plan could not be made.")} sub={p.reason ?? ""}>
      <div className="mx-actions"><Button onClick={onBack}>{t("Back")}</Button></div>
    </Card>
  );
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
        {p?.config ? <ConfigCard config={p.config} /> : null}
        <Card title={t("Load order")} sub={t("Each wave loads only after the waves it waits for are done.")}>
          {rows.length ? <DataTable columns={cols(mods)} rows={rows} rowKey={(r) => r.key} label={t("Load order")} /> : <EmptyState heading={t("Nothing to move")} body={t("The plan holds no steps. Go back and choose objects.")} />}
        </Card>
        <div className="mx-actions">
          <Button onClick={onBack}>{t("Back")}</Button>
          <Button variant="primary" disabled={!rows.length} onClick={onNext}>{t("Check before loading")}</Button>
        </div>
      </div>
    </Gate>
  );
}
