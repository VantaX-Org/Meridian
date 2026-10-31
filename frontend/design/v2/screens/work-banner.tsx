"use client";

import type { ReactNode } from "react";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Skeleton } from "../parts";
import { AutoCleaned } from "./CommandCentre";

/** The Work banner: what is open, in one sentence and three figures, with the one thing to do first. */
export function WorkBanner({ why, open, critical, proposed, action, pending }: { why: string; open: number; critical: number; proposed: number; action: ReactNode; pending: boolean }) {
  return (
    <section className="m2-cc-banner m2-wk-banner" data-verdict={critical > 0 ? "no-go" : open > 0 ? "at-risk" : "go"} aria-label={t("Open work")} data-testid="work-banner">
      <div className="m2-cc-verdict">
        <span className="m2-cc-eyebrow">{t("Open work")}</span>
        {pending ? <Skeleton width={260} height={24} /> : <strong>{t("{open} records to fix", { open: int(open) })}</strong>}
        {why ? (
          <span className="m2-cc-why" data-testid="work-sentence">
            {why}
          </span>
        ) : null}
      </div>
      <dl className="m2-cc-figs">
        <div>
          <dt>{t("Open records")}</dt>
          <dd>{int(open)}</dd>
          <dd className="m2-cc-note">{t("still failing a rule")}</dd>
        </div>
        <div>
          <dt>{t("Critical")}</dt>
          <dd>{int(critical)}</dd>
          <dd className="m2-cc-note">{t("fix these first")}</dd>
        </div>
        <div>
          <dt>{t("With a suggested value")}</dt>
          <dd>{int(proposed)}</dd>
          <dd className="m2-cc-note">{t("ready to accept")}</dd>
        </div>
      </dl>
      <div className="m2-cc-act">{action}</div>
    </section>
  );
}

export interface Bar {
  key: string;
  label: ReactNode;
  n: number;
  active: boolean;
  onPick: () => void;
}

/** Open records as horizontal bars. A bar filters the table; next to it, what monitoring has seen. */
export function WorkBreakdown({ title, bars }: { title: string; bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.n));
  return (
    <div className="m2-wk-strip" data-testid="work-breakdown">
      <section className="m2-cc-card" aria-label={title}>
        <h3>{title}</h3>
        {bars.length ? (
          <ul className="m2-cc-bars m2-wk-bars">
            {bars.map((b) => (
              <li key={b.key}>
                <button type="button" aria-pressed={b.active} onClick={b.onPick}>
                  <span className="m2-cc-bmsg">{b.label}</span>
                  <span className="m2-cc-bmeta">
                    <span>{t("{n} open", { n: int(b.n) })}</span>
                  </span>
                  <span className="m2-cc-bar">
                    <span style={{ width: `${Math.max(2, (b.n / max) * 100)}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m2-cc-empty">{t("Nothing is open.")}</p>
        )}
      </section>
      <AutoCleaned />
    </div>
  );
}
