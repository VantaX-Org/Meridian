"use client";

import type { ReactNode } from "react";
import type { Receipt as ReceiptData } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { DataTable, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, RuleLink } from "./tabs-g-parts";
import "./tabs-f.css";

type Line = { key: string; label: ReactNode; weight?: ReactNode; score?: ReactNode; points?: ReactNode; rules?: ReactNode; records?: ReactNode; coverage?: ReactNode };

function lines(r: ReceiptData): Line[] {
  const n = r.breaches.length;
  const out: Line[] = r.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    weight: `${Math.round(d.weight * 100)}%`,
    score: d.score == null ? <Dash why={t("Not measured")} /> : f1(d.score),
    points: d.points == null ? <Dash /> : f1(d.points),
    rules: int(d.rules_measured),
    records: int(d.records_checked),
    coverage: pct1(d.coverage),
  }));
  if (r.weighted != null) out.push({ key: "weighted", label: <b>{t("Weighted")}</b>, weight: "100%", points: f1(r.weighted), rules: int(r.rules_measured), records: int(r.records_checked), coverage: pct1(r.coverage) });
  out.push({ key: "measured", label: <b>{t("Measured")}</b>, points: f1(r.measured) });
  if (r.cap_level != null) out.push({ key: "cap", label: t("Held down by {n} critical {n, plural, one {rule} other {rules}} failing", { n }), points: r.capped ? `${r.cap_level}.0` : t("not reached") });
  out.push({ key: "shown", label: <b>{t("Score shown")}</b>, points: <b>{f1(r.score)}</b> });
  return out;
}

/** How the shown score is made: dimension by dimension, the sums, the cap, the formula and the critical rules that hold it down. */
export function Receipt({ receipt, open = true }: { receipt: ReceiptData; open?: boolean }) {
  const cols: Column<Line>[] = [
    { id: "dim", label: t("Dimension"), cell: (l) => l.label },
    { id: "weight", label: t("Weight"), cell: (l) => l.weight ?? null, align: "end" },
    { id: "score", label: t("Score"), cell: (l) => l.score ?? null, align: "end" },
    { id: "points", label: t("Points"), cell: (l) => l.points ?? null, align: "end" },
    { id: "rules", label: t("Rules measured"), cell: (l) => l.rules ?? null, align: "end" },
    { id: "records", label: t("Records checked"), cell: (l) => l.records ?? null, align: "end" },
    { id: "coverage", label: t("Coverage"), cell: (l) => l.coverage ?? null, align: "end" },
  ];
  const w = receipt.severity_weights;
  return (
    <details className="nx-tf-disclose" open={open} data-testid="receipt">
      <summary>{t("How {score} is made", { score: f1(receipt.score) })}</summary>
      <div className="nx-tf-stack">
        <ExportTable>
          <DataTable rows={lines(receipt)} columns={cols} rowKey={(l) => l.key} rowLabel={(l) => l.key} caption={t("How the score is made")} density="compact" />
        </ExportTable>
        {receipt.low_confidence ? (
          <p className="nx-tf-sub">
            <b>{t("Low confidence.")}</b> {t("Coverage {pct1} is low: part of the records could not be evaluated by at least one rule, so this score may move when extraction improves.", { pct1: pct1(receipt.coverage) })}
          </p>
        ) : null}
        <p className="nx-tf-sub" data-testid="receipt-footer">
          <span className="nx-mono">{receipt.formula}</span>
          {t("; severity weights critical {critical}, high {high}, medium {medium}, low {low}; tolerance {value}% of rows or {rows} rows, as set on each rule; cap rule: {cap_rule}.", { critical: w.critical, high: w.high, medium: w.medium, low: w.low, value: Math.round(receipt.tolerance.pct * 100), rows: receipt.tolerance.rows, cap_rule: receipt.cap_rule })}
        </p>
        {receipt.breaches.length > 0 ? (
          <section className="nx-tf-sec">
            <h3 className="nx-sec-h">{t("Critical rules failing on too many records")}</h3>
            <ul className="nx-tf-list" data-testid="breaches">
              {receipt.breaches.map((b) => (
                <li key={b.check_id}>
                  <RuleLink id={b.check_id} name={b.name} severity="critical" />
                  <span className="nx-tf-sub">{b.failing == null ? <Dash why={t("The count is not stored for this run")} /> : t("{failing} failing{value}", { failing: int(b.failing), value: b.pct == null ? "" : `, ${b.pct}%` })}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  );
}
