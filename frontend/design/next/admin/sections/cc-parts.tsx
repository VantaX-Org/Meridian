"use client";

import type { ReactNode } from "react";
import type { Verdict } from "@/lib/api/v2/types";
import { Chip, ProgressBar, type ChipTone } from "@/design/next/kit";
import { t } from "@/lib/v2/i18n";
import { PageTitle } from "./parts";

/** The page frame for Administration and People: one column, the full width. `title` is a hidden h1 where the banner carries the state. */
export function CcPage({ title, children }: { title?: string; children: ReactNode; dock?: boolean }) {
  return (
    <div className="nx-adm-cc">
      {title ? <div className="nx-sr"><PageTitle>{title}</PageTitle></div> : null}
      {children}
    </div>
  );
}

export interface CcFig {
  label: string;
  value: ReactNode;
  note?: string;
  /** What the figure means, on hover. */
  hint?: string;
  /** A figure that is itself bad news carries a status chip; a figure without one stays neutral. */
  tone?: "crit" | "warn";
}

const VERDICT: Record<Verdict, { tone: ChipTone; word: () => string }> = {
  go: { tone: "good", word: () => t("Go") },
  "at-risk": { tone: "warn", word: () => t("At risk") },
  "no-go": { tone: "bad", word: () => t("No-go") },
};

/** The headline of a page: one sentence of state, up to three figures, and the one thing to do next. */
export function CcBanner({ eyebrow, headline, verdict, why, figs = [], action, testId, label }: { eyebrow: string; headline: ReactNode; verdict?: Verdict; why?: ReactNode; figs?: CcFig[]; action?: ReactNode; testId: string; label: string }) {
  const v = verdict ? VERDICT[verdict] : null;
  return (
    <section className="nx-card nx-adm-blk" data-verdict={verdict} aria-label={label} data-testid={testId}>
      <span className="nx-reason">{eyebrow}</span>
      <h2 className="nx-kit-h2">{headline}</h2>
      {v ? <Chip tone={v.tone}>{v.word()}</Chip> : null}
      {why ? <p className="nx-reason">{why}</p> : null}
      {figs.length ? (
        <div className="nx-stat-row">
          {figs.map((f) => (
            <div key={f.label} className="nx-stat" title={f.hint} data-tone={f.tone}>
              <span className="nx-stat-label">{f.label}</span>
              <span className="nx-stat-value">{f.value}</span>
              {f.tone ? <Chip tone={f.tone === "crit" ? "bad" : "warn"}>{f.tone === "crit" ? t("Needs action") : t("Watch")}</Chip> : null}
              {f.note ? <span className="nx-reason">{f.note}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {action ? <div className="nx-adm-acts">{action}</div> : null}
    </section>
  );
}

export interface CcBarRow {
  key: string;
  /** The name, already with its code beside it where there is one. */
  label: ReactNode;
  value: number;
  /** The value in words, shown at the end of the row. */
  text: string;
  tone?: "crit" | "warn" | "pass" | "data";
  /** A sparkline of the value over time, shown after the bar when given. */
  spark?: ReactNode;
}

/** One row per item, every bar on the same scale from zero. */
export function CcHBars({ rows, label, testId }: { rows: CcBarRow[]; label: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sparks = rows.some((r) => r.spark);
  return (
    <div className="nx-table-scroll" data-testid={testId}>
      <table className="nx-table" aria-label={label}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="nx-tr">
              <td className="nx-td">{r.label}</td>
              <td className="nx-td nx-adm-wide">
                <ProgressBar value={(r.value / max) * 100} label={typeof r.label === "string" ? r.label : r.text} />
              </td>
              <td className="nx-td nx-end">{r.text}</td>
              {sparks ? <td className="nx-td">{r.spark}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
