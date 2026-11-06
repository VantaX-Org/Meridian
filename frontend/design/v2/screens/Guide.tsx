"use client";

import type { ReactNode } from "react";
import { V2Link } from "../parts";
import { InactiveChip, Lede, PrimaryAction } from "../RunParts";
import { t } from "@/lib/v2/i18n";
import "./stage6.css";

/** Names the system a page speaks about; a page that belongs to no one system leaves it out. */
export function SystemChip({ name, inactive }: { name: string; inactive?: boolean }) {
  return (
    <span className="m2-guide-head" data-testid="system-chip">
      <span className="m2-syschip">{name}</span>
      {inactive ? <InactiveChip /> : null}
    </span>
  );
}

/** Where the user is in multi-step work: steps before the current one are done, the current one is marked, the rest follow. */
export function Steps({ labels, current }: { labels: readonly string[]; current: number }) {
  const next = labels[current + 1];
  return (
    <nav className="m2-steps" aria-label={t("Steps")} data-testid="steps">
      <ol>
        {labels.map((l, i) => (
          <li key={l} className={i < current ? "m2-step-done" : i === current ? "m2-step-now" : "m2-step-next"} aria-current={i === current ? "step" : undefined}>
            <span className="m2-step-n">{i + 1}</span> {l}
          </li>
        ))}
      </ol>
      {next ? <p className="m2-meta">{t("After this: {step}", { step: next })}</p> : null}
    </nav>
  );
}

/** Detail kept one click away: a labelled fold that holds what the page does not need on first read. */
export function Disclose({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="m2-disclose" open={open} data-testid="disclose">
      <summary>{title}{hint ? <span className="m2-meta"> {hint}</span> : null}</summary>
      {children}
    </details>
  );
}

/**
 * The top of a screen for a new reader: what it shows, the one next action (the only filled button, passed in), and
 * what each figure means. `means` pairs a figure's name with its definition.
 */
export function Guide({ shows, action, next, why, means, system, inactive, extra, steps }: { steps?: { labels: readonly string[]; current: number }; shows: ReactNode; action?: ReactNode; next?: { href: string; label: string }; why?: ReactNode; means?: readonly (readonly [string, string])[]; system?: string | null; inactive?: boolean; extra?: ReactNode }) {
  return (
    <div className="m2-guide" data-testid="guide">
      {system || extra ? (
        <div className="m2-guide-head">
          {system ? <SystemChip name={system} inactive={inactive} /> : null}
          {extra}
        </div>
      ) : null}
      <Lede>{shows}</Lede>
      {steps ? <Steps {...steps} /> : null}
      {action ?? next ? <PrimaryAction action={action ?? <V2Link className="m2-btn m2-strong" href={next!.href}>{next!.label}</V2Link>} why={why} /> : null}
      {means?.length ? (
        <details className="m2-guide-means">
          <summary>{t("What the figures mean")}</summary>
          <dl>
            {means.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}
