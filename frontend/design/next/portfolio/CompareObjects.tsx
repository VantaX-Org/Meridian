"use client";

import type { ReactNode } from "react";
import { formatDate, formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { actionOf, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Button, EmptyState, Sparkline } from "../kit";
import { stepLabel } from "./Cards";

type Metric = { label: () => string; value: (r: PortfolioRow) => string | number; show?: (r: PortfolioRow) => ReactNode };

const METRICS: Metric[] = [
  { label: () => t("DQS"), value: (r) => f1(r.composite_score) },
  { label: () => t("Measured score"), value: (r) => f1(r.measured_score) },
  { label: () => t("Raw score"), value: (r) => f1(r.raw_score) },
  { label: () => t("New"), value: (r) => r.new_issues, show: (r) => formatInt(r.new_issues) },
  { label: () => t("Resolved"), value: (r) => r.resolved, show: (r) => formatInt(r.resolved) },
  { label: () => t("Regressed"), value: (r) => r.regressed, show: (r) => formatInt(r.regressed) },
  { label: () => t("Run"), value: (r) => t("Run {n}, {date}", { n: formatInt(r.run_number ?? 0), date: formatDate(r.run_at) }) },
  { label: () => t("Cycle stage"), value: (r) => stepLabel(actionOf(r)) },
];

/** Two to six objects side by side, one column each; the matrix exports to Excel as it stands. */
export function CompareObjects({ rows, sysName }: { rows: PortfolioRow[]; sysName: (id: string | null) => string }) {
  if (rows.length < 2) return <EmptyState icon="columns" heading={t("Pick two or more objects to compare them side by side.")}>{t("Select objects on the cards or in the table, then choose Compare.")}</EmptyState>;
  const head = rows.map((r) => `${r.label} (${r.module}), ${sysName(r.system_id)}`);
  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const aoa = [[t("Measure"), ...head], ...METRICS.map((m) => [m.label(), ...rows.map(m.value)])];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), t("Compare"));
    XLSX.writeFile(book, "objects-compared.xlsx");
  };
  return (
    <div className="nx-card nx-pf-compare">
      <div className="nx-pf-compare-bar">
        <Button size={32} icon="download" onClick={() => void exportXlsx()}>{t("Export to Excel")}</Button>
      </div>
      <div className="nx-pf-scroll">
        <table className="nx-pf-matrix">
          <caption className="nx-sr">{t("Objects compared side by side")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Measure")}</th>
              {rows.map((r) => (
                <th scope="col" key={r.version_id}>
                  <strong>{r.label}</strong> <span className="nx-mono nx-pf-code">{r.module}</span>
                  <div className="nx-pf-meta">{sysName(r.system_id)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t("DQS trend")}</th>
              {rows.map((r) => <td key={r.version_id}>{r.trend.length > 1 ? <Sparkline points={r.trend} label={t("DQS trend of {name}", { name: r.label })} /> : "–"}</td>)}
            </tr>
            {METRICS.map((m, i) => (
              <tr key={i}>
                <th scope="row">{m.label()}</th>
                {rows.map((r) => <td key={r.version_id}>{m.show ? m.show(r) : m.value(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
