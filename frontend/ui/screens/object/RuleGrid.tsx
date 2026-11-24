"use client";

/** The one rule grid of the object screen: every measured rule, failing first, with URL state (sort, filters, group, open row). */
import { DIMENSIONS, type RuleRow } from "@/lib/api/v2/types";
import type { BackAfterClean } from "@/lib/api/remediation";
import { t } from "@/lib/v2/i18n";
import { DASH, f1, int } from "@/lib/v2/score";
import { Button, DataTable, FieldChip, SeverityPill, type Column } from "@/ui/kit";
import type { TableFilter } from "@/ui/kit/DataTable";
import type { GridApi } from "@/ui/kit/useGridState";
import { compactCount } from "./format";
import type { ObjectData } from "./useObjectData";

export const GRID_KEY = "rules";
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
export const dimLabel = (k: string): string => DIMENSIONS.find((x) => x.key === k)?.label ?? t("No dimension");

/** A rule plus the facts the filters need. `propN` and `backN` are null when the data behind them is absent. */
export interface RuleView extends RuleRow {
  state: "failing" | "passing";
  cap: "yes" | "no";
  proposal: "yes" | "no";
  backf: "yes" | "no";
  dim: string;
  propN: number | null;
  backN: number | null;
}

export function buildRules(d: ObjectData, back: BackAfterClean | undefined): RuleView[] {
  const work = new Map(d.groups.map((g) => [g.check_id, Math.min(g.proposed, g.open)]));
  const backBy = new Map((back?.rules ?? []).map((x) => [x.check_id, x.back]));
  const caps = new Set(d.capIds);
  return d.all.map((r) => {
    const propN = d.groups.length ? work.get(r.check_id) ?? 0 : null;
    const backN = back ? backBy.get(r.check_id) ?? 0 : null;
    return {
      ...r,
      state: r.affected_count > 0 ? "failing" : "passing",
      cap: caps.has(r.check_id) ? "yes" : "no",
      proposal: propN ? "yes" : "no",
      backf: backN ? "yes" : "no",
      dim: r.dimension ?? "none",
      propN,
      backN,
    };
  });
}

/** The chips that say what the grid is narrowed to, each removable. */
export function ActiveFilters({ grid, labelFor }: { grid: GridApi; labelFor: (col: string, v: string) => string }) {
  const chips = Object.entries(grid.filters).flatMap(([col, vs]) => vs.map((v) => ({ col, v })));
  return (
    <div className="mx-active" role="group" aria-label={t("Active filters")}>
      {chips.length ? chips.map(({ col, v }) => (
        <button key={`${col}:${v}`} type="button" className="mx-fchip" onClick={() => grid.setFilter(col, (grid.filters[col] ?? []).filter((x) => x !== v))} aria-label={t("Remove filter {name}", { name: labelFor(col, v) })}>
          {labelFor(col, v)} <span aria-hidden="true">x</span>
        </button>
      )) : <span className="mx-muted">{t("No filters")}</span>}
      {chips.length > 1 ? <Button variant="ghost" onClick={grid.clearFilters}>{t("Clear all")}</Button> : null}
    </div>
  );
}

export function RuleGrid({ rows, grid, currency, href, hasProposal, hasBack }: {
  rows: RuleView[]; grid: GridApi; currency: string | null; href: (path: string) => string; hasProposal: boolean; hasBack: boolean;
}) {
  const field = (x: RuleView) => (x.field ? <FieldChip code={x.field} description={x.field_description ?? ""} /> : DASH);
  const columns: Column<RuleView>[] = [
    { key: "rule", label: t("Rule"), width: 340, value: (x) => x.check_id, sort: (x) => x.name, render: (x) => <><code className="mx-code">{x.check_id}</code> {x.name.replace(/^[^:]+:\s*/, "")}</> },
    { key: "severity", label: t("Severity"), groupable: true, width: 96, value: (x) => x.severity, sort: (x) => RANK[x.severity] ?? 9, groupLabel: sevLabel, render: (x) => <SeverityPill sev={x.severity} label={sevLabel(x.severity)} /> },
    { key: "field", label: t("Field"), value: (x) => x.field ?? "", render: field },
    { key: "affected", label: t("Failing records"), align: "end", sort: (x) => x.affected_count, render: (x) => int(x.affected_count) },
    { key: "pass", label: t("Pass rate"), align: "end", sort: (x) => x.pass_rate ?? -1, render: (x) => (x.pass_rate === null ? DASH : `${f1(x.pass_rate)}%`) },
    ...(hasProposal ? [{ key: "propN", label: t("With proposal"), align: "end" as const, sort: (x: RuleView) => x.propN ?? 0, render: (x: RuleView) => (x.propN === null ? DASH : compactCount(x.propN)) }] : []),
    ...(hasBack ? [{ key: "backN", label: t("Back after clean"), align: "end" as const, sort: (x: RuleView) => x.backN ?? 0, render: (x: RuleView) => (x.backN === null ? DASH : compactCount(x.backN)) }] : []),
    { key: "risk", label: currency ? t("{cur} at risk", { cur: currency }) : t("Value at risk"), align: "end", sort: (x) => x.value_at_risk ?? 0, render: (x) => (x.value_at_risk === null ? DASH : int(x.value_at_risk)) },
    { key: "dim", label: t("Dimension"), groupable: true, groupLabel: dimLabel, value: (x) => x.dim, render: (x) => dimLabel(x.dim) },
    // Filter-only columns: the KPI tiles and chips set these through the URL.
    { key: "state", label: t("State"), defaultHidden: true, value: (x) => x.state },
    { key: "cap", label: t("Holds the cap"), defaultHidden: true, value: (x) => x.cap },
    { key: "proposal", label: t("Has a proposal"), defaultHidden: true, value: (x) => x.proposal },
    { key: "backf", label: t("Came back"), defaultHidden: true, value: (x) => x.backf },
  ];
  const filters: TableFilter[] = [
    { column: "severity", label: t("Severity"), options: ["critical", "high", "medium", "low", "info"].map((s) => ({ value: s, label: sevLabel(s) })) },
    { column: "dim", label: t("Dimension"), options: [...DIMENSIONS.map((x) => x.key as string), "none"].map((k) => ({ value: k, label: dimLabel(k) })) },
    { column: "state", label: t("State"), options: [{ value: "failing", label: t("Failing") }, { value: "passing", label: t("Passing") }] },
    { column: "cap", label: t("Holds the cap"), options: [{ value: "yes", label: t("Yes") }, { value: "no", label: t("No") }] },
  ];
  return (
    <DataTable
      id="object-rules"
      label={t("Every measured rule")}
      rowKey={(x) => x.check_id}
      rows={rows}
      grid={grid}
      columns={columns}
      filters={filters}
      height={460}
      footer
      stickyFirst
      groupSum={{ label: t("Failing records"), value: (x) => x.affected_count }}
      rowHref={undefined}
      toolbar={<Button variant="ghost" href={href("/rules")}>{t("Open the rule library")}</Button>}
    />
  );
}

const FILTER_FIELD: Record<string, keyof RuleView> = { severity: "severity", dim: "dim", state: "state", cap: "cap", proposal: "proposal", backf: "backf" };

/** The rows the URL filters leave, for the panel's previous and next rule. Order follows the data, not the grid sort. */
export function visibleRules(rows: RuleView[], grid: GridApi): RuleView[] {
  return rows.filter((r) => Object.entries(grid.filters).every(([col, vs]) => !vs.length || !FILTER_FIELD[col] || vs.includes(String(r[FILTER_FIELD[col]]))));
}
