"use client";

import type { ReactNode } from "react";
import type { Verdict } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { VerdictMark } from "../marks";
import { AletheiaDock } from "./CommandCentre";

/** The Command centre page frame: the content beside the docked Aletheia, stacked below it on narrow screens. */
export function CcPage({ children }: { children: ReactNode }) {
  return (
    <div className="m2-cc">
      <div className="m2-cc-main">{children}</div>
      <AletheiaDock />
    </div>
  );
}

export interface CcFig {
  label: string;
  value: ReactNode;
  note?: string;
}

/** The headline of a page: one sentence of state, up to three figures, and the one thing to do next. */
export function CcBanner({ eyebrow, headline, verdict, why, figs = [], action, testId, label }: { eyebrow: string; headline: ReactNode; verdict?: Verdict; why?: ReactNode; figs?: CcFig[]; action?: ReactNode; testId: string; label: string }) {
  return (
    <section className="m2-cc-banner" data-verdict={verdict} aria-label={label} data-testid={testId}>
      <div className="m2-cc-verdict">
        <span className="m2-cc-eyebrow">{eyebrow}</span>
        <strong>
          {verdict ? <VerdictMark verdict={verdict} /> : null} {headline}
        </strong>
        {why ? <span className="m2-cc-why">{why}</span> : null}
      </div>
      {figs.length ? (
        <dl className="m2-cc-figs">
          {figs.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
              {f.note ? <span>{f.note}</span> : null}
            </div>
          ))}
        </dl>
      ) : null}
      {action ? <div className="m2-cc-act">{action}</div> : null}
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
}

/** Horizontal bars, one row per item, every bar on the same scale from zero. */
export function CcHBars({ rows, label, testId }: { rows: CcBarRow[]; label: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="m2-cc-hbars" aria-label={label} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="m2-cc-hlabel">{r.label}</span>
          <span className="m2-cc-track" aria-hidden="true">
            <span data-tone={r.tone ?? "data"} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="m2-cc-hval">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export interface CcDeltaRow {
  key: string;
  label: ReactNode;
  /** Positive is better. */
  delta: number | null;
  text: string;
}

/** Diverging bars around a centre line: better to the right in green, worse to the left in red. */
export function CcDelta({ rows, label, testId }: { rows: CcDeltaRow[]; label: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.delta ?? 0)));
  return (
    <div data-testid={testId}>
      <div className="m2-cc-legend" aria-hidden="true">
        <span>{t("Worse")}</span>
        <span>{t("Better")}</span>
      </div>
      <ul className="m2-cc-hbars m2-cc-delta" aria-label={label}>
        {rows.map((r) => {
          const w = r.delta == null ? 0 : (Math.abs(r.delta) / max) * 50;
          return (
            <li key={r.key}>
              <span className="m2-cc-hlabel">{r.label}</span>
              <span className="m2-cc-track" aria-hidden="true">
                {r.delta ? <span data-tone={r.delta > 0 ? "pass" : "crit"} style={r.delta > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} /> : null}
              </span>
              <span className="m2-cc-hval">{r.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
