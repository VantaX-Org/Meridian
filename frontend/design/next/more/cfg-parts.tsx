"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { LargeTitle } from "../kit";
import "./config-materials.css";

/**
 * Small layout pieces shared by the Configuration, Data requests and Materials screens. They only arrange kit
 * classes (nx-card, nx-stat, nx-stat-label, nx-stat-value) and the kit LargeTitle; config-materials.css is layout only.
 */

/** A solid content sheet with a heading and an optional one-line meta. */
export function Panel({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section className="nx-card nx-cfg-panel" aria-label={title} data-testid={testId}>
      <header className="nx-cfg-head">
        <h2>{title}</h2>
        {meta ? <span className="nx-sub">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** The screen header: the kit large title, its sentence, and the stat strip below it. */
export function Banner({ title, why, meta, label, testId, figs, children }: { title: string; why: ReactNode; meta: string; label: string; testId: string; figs: Fig[]; children?: ReactNode }) {
  return (
    <section className="nx-cfg-panel" aria-label={label} data-testid={testId}>
      <LargeTitle title={title} subtitle={why} meta={<span className="nx-sub">{meta}</span>} />
      <Figs figs={figs} label={label} />
      {children}
    </section>
  );
}

export interface Fig { label: string; value: string; note?: string }

/** The headline figures of a screen: label, value and a short note, side by side. */
export function Figs({ figs, label }: { figs: Fig[]; label: string }) {
  return (
    <dl className="nx-cfg-figs" aria-label={label}>
      {figs.map((f) => (
        <div key={f.label} className="nx-card nx-stat">
          <dt className="nx-stat-label">{f.label}</dt>
          <dd className="nx-stat-value">{f.value}</dd>
          {f.note ? <dd className="nx-sub">{f.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** A section folded away until it is wanted. */
export function Fold({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="nx-card nx-cfg-fold">
      <summary>
        <span className="nx-cfg-foldtitle">{title}</span>
        <span className="nx-sub">{hint}</span>
      </summary>
      <div className="nx-cfg-foldbody">{children}</div>
    </details>
  );
}

/** What the screen shows, what reading it changes, what its figures mean and where to go next. */
export function About({ shows, why, means, next }: { shows: string; why: string; means: [string, string][]; next: { href: string; label: string } }) {
  return (
    <details className="nx-card nx-cfg-fold">
      <summary>
        <span className="nx-cfg-foldtitle">{t("About")}</span>
        <span className="nx-sub">{shows}</span>
      </summary>
      <div className="nx-cfg-foldbody">
        <p className="nx-sub">{why}</p>
        <dl className="nx-cfg-means">
          {means.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd className="nx-sub">{text}</dd>
            </div>
          ))}
        </dl>
        <Link href={next.href}>{next.label}</Link>
      </div>
    </details>
  );
}

/** A labelled horizontal bar per row, 0 to 100, with its sentence beside it. */
export function HBars({ label, rows }: { label: string; rows: { key: string; label: ReactNode; value: number; text: string; tone: "good" | "warn" | "bad" }[] }) {
  return (
    <ul className="nx-cfg-hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="nx-cfg-hbar">
          <span className="nx-cfg-hlabel">{r.label}</span>
          <span className="nx-cfg-track" aria-hidden="true">
            <span className="nx-cfg-fill" data-tone={r.tone} style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }} />
          </span>
          <span className="nx-sub">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
