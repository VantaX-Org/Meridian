"use client";

import type { ReactNode } from "react";
import type { LandscapeCell, Receipt } from "@/lib/api/v2/types";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { moneyCompactText } from "@/lib/v2/labels";
import { f1, int, VERDICT_LABEL } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { VerdictMark } from "../../marks";
import { V2Link } from "../../parts";

/** The object's headline: the S/4 verdict, the score in plain words, what it costs, and the one thing to do next. */
export function ObjectBanner({ cell, receipt, label, system, module, cap }: { cell: LandscapeCell; receipt: Receipt | undefined; label: string; system: string; module: string; cap: ReactNode }) {
  const blockers = cell.breaches.length;
  const open = receipt?.open_work ?? cell.open_work ?? 0;
  const risk = receipt?.value_at_risk;
  const apiModule = encodeURIComponent(module);
  return (
    <section className="m2-cc-banner m2-co-banner" data-verdict={cell.verdict} aria-label={t("S/4 readiness")} data-testid="object-banner">
      <div className="m2-cc-verdict">
        <span className="m2-cc-eyebrow">{t("{label} on {system}: S/4 readiness", { label, system: decodeURIComponent(system) })}</span>
        <strong>
          <VerdictMark verdict={cell.verdict} /> {VERDICT_LABEL[cell.verdict]}
        </strong>
        <span className="m2-cc-why" data-testid="cap-sentence">
          {cap}
        </span>
      </div>
      <dl className="m2-cc-figs">
        <div>
          <dt>{t("Records to fix")}</dt>
          <dd>{receipt || cell.open_work != null ? int(open) : "—"}</dd>
          <span>{t("of {n} checked", { n: int(cell.records_checked) })}</span>
        </div>
        <div>
          <dt>{t("Money at risk")}</dt>
          <dd>{risk == null ? "—" : moneyCompactText(risk, receipt?.currency)}</dd>
          <span>{risk == null ? t("no cost model") : receipt?.cost_model_source === "default" ? t("estimate, default costs") : t("per month")}</span>
        </div>
      </dl>
      <div className="m2-cc-act">
        {blockers > 0 ? (
          <V2Link href={`/work?module=${apiModule}&severity=critical`} className="m2-btn m2-next">
            {t("Fix {n} blockers", { n: int(blockers) })}
          </V2Link>
        ) : open > 0 ? (
          <V2Link href={`/work?module=${apiModule}`} className="m2-btn m2-next">
            {t("Fix {n} records", { n: int(open) })}
          </V2Link>
        ) : (
          <V2Link href={`/o/${system}/${module}/runs`} className="m2-btn m2-next">
            {t("Review the runs")}
          </V2Link>
        )}
      </div>
    </section>
  );
}

/** The six dimensions as bars with their full names, the score and the share of the total each one carries. */
export function DimensionBars({ cell }: { cell: LandscapeCell }) {
  return (
    <section className="m2-cc-card" aria-label={t("Score by dimension")} data-testid="dimension-bars">
      <h3>{t("Score by dimension")}</h3>
      <ul className="m2-co-dims">
        {DIMENSIONS.map((d) => {
          const v = cell.dimensions[d.key] ?? null;
          return (
            <li key={d.key}>
              <span className="m2-co-dn">
                {d.label}
                <span>{t("{n}% of the score", { n: Math.round(d.weight * 100) })}</span>
              </span>
              <span className="m2-cc-bar m2-co-dbar" aria-hidden="true">
                <span style={{ width: `${v == null ? 0 : Math.max(0, Math.min(100, v))}%` }} />
              </span>
              <span className="m2-co-dv">{v == null ? t("not measured") : f1(v)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
