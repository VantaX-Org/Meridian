"use client";

import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import { Sparkline } from "../kit";
import { objectHref } from "../portfolio/BulkBar";

/** A compact half-width card for an object with nothing to do. */
export function QuietCard({ row, sysName }: { row: PortfolioRow; sysName: (id: string | null) => string }) {
  return (
    <li className="nx-fd-quiet-card" data-testid="quiet-card">
      <strong>{row.label}</strong>
      <span className="nx-fd-quiet-score"><span className="nx-sr">{t("DQS {v}", { v: f1(row.composite_score) })}</span><span aria-hidden="true">{f1(row.composite_score)}</span></span>
      {row.trend.length > 1 ? <Sparkline points={row.trend.slice(-12)} label={t("DQS trend of {name}", { name: row.label })} /> : null}
      <V2Link className="nx-btn nx-btn-quiet nx-btn-sm" href={objectHref(row, sysName, `?run=${row.version_id}`)}>{t("Open")}</V2Link>
    </li>
  );
}

export function QuietRow({ rows, sysName }: { rows: PortfolioRow[]; sysName: (id: string | null) => string }) {
  if (!rows.length) return null;
  return (
    <section aria-labelledby="fd-quiet">
      <h2 id="fd-quiet" className="nx-fd-quiet-h">{t("Quiet today")}</h2>
      <ul className="nx-fd-quiet">{rows.map((r) => <QuietCard key={r.version_id} row={r} sysName={sysName} />)}</ul>
    </section>
  );
}
