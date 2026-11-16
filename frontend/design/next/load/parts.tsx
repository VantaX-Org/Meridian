"use client";

/** The pieces the Load tabs share: a titled panel, a closed section, horizontal bars, a headline banner and the guide. */
import type { ReactNode } from "react";
import { Chip, type ChipTone } from "../kit";
import { t } from "@/lib/v2/i18n";
import { VERDICT_LABEL } from "@/lib/v2/score";

export type Verdict = "go" | "at-risk" | "no-go";
const VERDICT_TONE: Record<Verdict, ChipTone> = { go: "good", "at-risk": "warn", "no-go": "bad" };

/** A solid content sheet with a heading, a one-line meta and its body. */
export function Panel({ title, meta, testId, action, children }: { title: string; meta?: ReactNode; testId?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="nx-card nx-ld-panel" aria-label={title} data-testid={testId}>
      <header className="nx-ld-panel-head">
        <div>
          <h3>{title}</h3>
          {meta ? <p className="nx-ld-meta">{meta}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A closed section the reader opens when they want the detail. */
export function Disclose({ summary, children, open }: { summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="nx-card nx-ld-disclose" open={open}>
      <summary>{summary}</summary>
      <div className="nx-ld-disclose-body">{children}</div>
    </details>
  );
}

export interface Fig {
  label: string;
  value: ReactNode;
  note?: string;
  hint?: string;
  tone?: "bad" | "warn";
}

/** The headline of a tab: the verdict, one sentence of state, why, the figures and the next action. */
export function Banner({ eyebrow, headline, verdict, why, figs, action, testId }: { eyebrow?: string; headline: ReactNode; verdict?: Verdict; why?: ReactNode; figs: Fig[]; action?: ReactNode; testId: string }) {
  return (
    <section className="nx-card nx-ld-banner" data-verdict={verdict} data-testid={testId}>
      <div className="nx-ld-banner-head">
        {eyebrow ? <span className="nx-ld-meta">{eyebrow}</span> : null}
        <h2>
          {verdict ? <Chip tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Chip> : null} <span>{headline}</span>
        </h2>
        {why ? <p className="nx-ld-lede">{why}</p> : null}
      </div>
      {/* Kit stat cards; StatCard itself takes only a number, and these figures are dates, dashes and scores. */}
      <dl className="nx-ld-figs">
        {figs.map((f) => (
          <div key={f.label} className="nx-card nx-stat" title={f.hint}>
            <dt className="nx-stat-label">{f.label}</dt>
            <dd className={f.tone ? `nx-stat-value nx-tone-${f.tone}` : "nx-stat-value"}>{f.value}</dd>
            {f.note ? <dd className="nx-stat-against">{f.note}</dd> : null}
          </div>
        ))}
      </dl>
      {action ? <div className="nx-ld-actions">{action}</div> : null}
    </section>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  text: string;
  tone?: "bad" | "warn" | "good" | "data";
}

/** Horizontal bars, every bar on the same scale from zero. */
export function HBars({ rows, label, testId }: { rows: BarRow[]; label: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="nx-ld-hbars" aria-label={label} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="nx-ld-hbar-label">{r.label}</span>
          <span className="nx-ld-hbar-track" aria-hidden>
            <span className="nx-ld-hbar-fill" data-tone={r.tone ?? "data"} style={{ inlineSize: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="nx-ld-hbar-text">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** What a tab shows, the steps of its work and what its figures mean, folded away until asked for. */
export function About({ shows, steps, current, means, next }: { shows: string; steps?: string[]; current?: number; means?: [string, string][]; next?: ReactNode }) {
  return (
    <Disclose summary={t("About")}>
      <p className="nx-ld-lede">{shows}</p>
      {steps ? (
        <ol className="nx-ld-about-steps">
          {steps.map((s, i) => <li key={s} aria-current={i === current ? "step" : undefined}>{s}</li>)}
        </ol>
      ) : null}
      {means?.length ? (
        <dl className="nx-ld-means">
          {means.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      ) : null}
      {next ? <div className="nx-ld-actions">{next}</div> : null}
    </Disclose>
  );
}
